# routers/v1_0_0/checks.py
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from uuid import uuid4

router = APIRouter()

@router.post("/checks")
async def detector_checks_v1_0_0(request: Request):
    # Read raw image bytes
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body, expected image bytes")

    # Request-Id is optional in v1.0.0 (based on your stub)
    request_id = request.headers.get("x-request-id") or str(uuid4())
    user_id = request.headers.get("x-user-id", "unknown")

    bytes_in = len(body)  # you can actually use this in metrics if you want

    # Legacy fixed result
    result = {
        "is_ai": True,
        "score": 0.87
    }

    print(f"[Detector v1.0.0] request_id={request_id} user_id={user_id} bytes_in={bytes_in}")

    return JSONResponse(result)
