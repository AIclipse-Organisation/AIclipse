import os, sys, time, threading
from datetime import datetime
import redis
from fastapi import FastAPI
import logging
from logging.handlers import RotatingFileHandler

# Observer service: reads Redis Stream events and writes structured logs for E2E validation.

app = FastAPI()

# Config via env to match other services
REDIS_URI = os.getenv("REDIS_URI")
STREAM    = os.getenv("STREAM")
GROUP     = os.getenv("GROUP")
HOSTNAME  = os.getenv("HOSTNAME")
LOG_LEVEL    = "INFO"
LOG_TO_FILE  = "true"
LOG_FILE     = "/tmp/observer.log"
LOG_FILE_MB  = 10
LOG_BACKUPS  = 5

# Structured logging to stdout and optional rotating file
logger = logging.getLogger("observer")
logger.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))
fmt = logging.Formatter("%(asctime)s %(levelname)s %(message)s", "%Y-%m-%d %H:%M:%S")

sh = logging.StreamHandler(sys.stdout)
sh.setFormatter(fmt)
logger.addHandler(sh)

if LOG_TO_FILE:
    fh = RotatingFileHandler(LOG_FILE, maxBytes=LOG_FILE_MB*1024*1024, backupCount=LOG_BACKUPS)
    fh.setFormatter(fmt)
    logger.addHandler(fh)

r = None

def _connect():
    # Single Redis client with decoded strings
    return redis.Redis.from_url(REDIS_URI, decode_responses=True)

def _ensure_group():
    # Create consumer group at the head; ignore if it already exists
    try:
        r.xgroup_create(STREAM, GROUP, id="0", mkstream=True)
    except redis.ResponseError as e:
        if "BUSYGROUP" not in str(e):
            raise

def _observe():
    # Blocking read loop: log each event and ack to avoid pending buildup
    consumer = HOSTNAME
    while True:
        try:
            res = r.xreadgroup(GROUP, consumer, {STREAM: ">"}, block=5000, count=1)
        except Exception as e:
            logger.warning("xreadgroup_error err=%s", e)
            time.sleep(1)
            continue
        if not res:
            continue
        for _, msgs in res:
            for mid, fields in msgs:
                kv = " ".join(f"{k}={fields[k]}" for k in sorted(fields))
                logger.info("event id=%s stream=%s group=%s host=%s %s", mid, STREAM, GROUP, HOSTNAME, kv)
                try:
                    r.xack(STREAM, GROUP, mid)
                except Exception as e:
                    logger.warning("xack_failed id=%s err=%s", mid, e)

@app.on_event("startup")
def start():
    # Connect with retry, ensure group exists, then start the observer thread
    global r
    while True:
        try:
            r = _connect()
            r.ping()
            break
        except Exception as e:
            logger.warning("redis_connect_retry err=%s", e)
            time.sleep(1)
    while True:
        try:
            _ensure_group()
            break
        except Exception as e:
            logger.warning("ensure_group_retry err=%s", e)
            time.sleep(1)
    logger.info("observer_started stream=%s group=%s host=%s", STREAM, GROUP, HOSTNAME)
    threading.Thread(target=_observe, daemon=True).start()

@app.get("/healthz")
def healthz():
    return {"status": "ok"}
