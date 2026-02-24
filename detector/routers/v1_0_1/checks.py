import os
import anyio
from anyio import to_thread
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse

from detector_modules.service.detector_service import predict_from_bytes
from routers.swagger.detector_params import checksv101_params

router = APIRouter()

QUEUE_TIMEOUT_S = float(os.getenv("DETECTOR_QUEUE_TIMEOUT_S", "25"))

# Max allowed time for actual inference work.
INFER_TIMEOUT_S = float(os.getenv("DETECTOR_INFER_TIMEOUT_S", "15"))


@router.post("/checks", openapi_extra=checksv101_params)
async def detector_checks_v1_0_1(request: Request):
    request_id = request.headers.get("x-request-id")
    if not request_id:
        raise HTTPException(status_code=400, detail="Missing X-Request-Id header")

    inflight = request.app.state.inflight_limiter
    infer = request.app.state.infer_limiter

    inflight_acquired = False
    infer_acquired = False

    try:
        with anyio.fail_after(QUEUE_TIMEOUT_S):
            await inflight.acquire()
            inflight_acquired = True
    except TimeoutError:
        raise HTTPException(status_code=503, detail="busy")

    try:
        try:
            with anyio.fail_after(QUEUE_TIMEOUT_S):
                await infer.acquire()
                infer_acquired = True
        except TimeoutError:
            raise HTTPException(status_code=503, detail="busy")

        body = await request.body()
        if not body:
            raise HTTPException(status_code=400, detail="Empty body, expected image bytes")

        try:
            with anyio.fail_after(INFER_TIMEOUT_S):
                verdict, confidence, label = await to_thread.run_sync(predict_from_bytes, body)
        except TimeoutError:
            raise HTTPException(status_code=504, detail="timeout")

        result = {"verdict": verdict, "label": label, "confidence": confidence}

        print(
            f"[Detector v1.0.1] Results: verdict={result['verdict']} "
            f"label={result['label']} confidence={result['confidence']}"
        )
        print(f"[Detector v1.0.1] request_id={request_id}")

        return JSONResponse(result)

    finally:
        if infer_acquired:
            infer.release()
        if inflight_acquired:
            inflight.release()