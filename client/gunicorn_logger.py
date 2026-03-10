from gunicorn.glogging import Logger


class HealthLogger(Logger):
    def access(self, resp, req, environ, request_time):
        path = environ.get("PATH_INFO", "")
        if path == "/healthz":
            return
        super().access(resp, req, environ, request_time)