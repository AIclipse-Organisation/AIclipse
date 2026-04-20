from fastapi import Request


_VALID_EXTERNAL_PROTOS = {"http", "https"}


def get_external_proto(request: Request) -> str | None:
    raw_value = (
        request.headers.get("x-external-proto")
        or request.headers.get("x-forwarded-proto")
        or request.url.scheme
    )
    proto = str(raw_value or "").split(",", 1)[0].strip().lower()
    if proto in _VALID_EXTERNAL_PROTOS:
        return proto
    return None


def build_external_proto_headers(request: Request) -> dict[str, str]:
    proto = get_external_proto(request)
    if not proto:
        return {}
    return {"X-External-Proto": proto}
