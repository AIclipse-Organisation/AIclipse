import Redis from "ioredis";

const host = process.env.REDIS_HOST;
const port = Number(process.env.REDIS_PORT);
const password = process.env.REDIS_PASSWORD;
const REDIS_ERROR_LOG_WINDOW_MS = 10_000;

let lastRedisError = {
  message: null,
  loggedAt: 0,
};

function shouldLogRedisError(message) {
  const now = Date.now();
  if (
    message !== lastRedisError.message ||
    now - lastRedisError.loggedAt >= REDIS_ERROR_LOG_WINDOW_MS
  ) {
    lastRedisError = { message, loggedAt: now };
    return true;
  }
  return false;
}

const getRedisClient = () => {
  const client = new Redis({
    host,
    port,
    password,
    maxRetriesPerRequest: 5,
    enableReadyCheck: true,
    connectTimeout: 2_000,
  });

  client.on("error", (err) => {
    const message = err?.message || String(err);
    if (shouldLogRedisError(message)) {
      console.error("[redis] error:", message);
    }
  });

  return client;
};

let redis;

export function getRedis() {
  if (process.env.APP_ENV === "dev") {
    if (!redis) {
      redis = getRedisClient();
    }
    return redis;
  }

  if (!global.redis) {
    global.redis = getRedisClient();
  }
  redis = global.redis;
  return redis;
}

function clearRedisCache(client) {
  if (redis === client) {
    redis = undefined;
  }
  if (global.redis === client) {
    delete global.redis;
  }
}

export function disposeRedis(client) {
  if (!client) {
    return;
  }

  clearRedisCache(client);

  try {
    client.removeAllListeners("error");
  } catch {
    // ignore listener cleanup on already torn-down clients
  }

  try {
    client.disconnect();
  } catch {
    // best-effort cleanup for a failed client before the next retry
  }
}
