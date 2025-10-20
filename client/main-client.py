import logging
from flask import Flask, send_from_directory
from werkzeug.serving import WSGIRequestHandler

# Client service.
# Serves the simulation UI and a lightweight health endpoint.
# Silences /healthz from access logs to keep noise low.

app = Flask(__name__)

@app.get("/healthz")
def healthz():
    return "OK", 200

@app.get("/")
def index():
    # Serve the single-page simulation UI
    return send_from_directory("templates", "index.html")

class Quiet(WSGIRequestHandler):
    # Suppress access logs for /healthz
    def log(self, type, message, *args):
        try:
            if getattr(self, "path", "").split("?", 1)[0] == "/healthz":
                return
        except Exception:
            pass
        super().log(type, message, *args)

if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.INFO)
    app.run(host="0.0.0.0", port=3000, request_handler=Quiet)
