from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import JSONResponse
from detector_modules.service.detector_service import predict_from_bytes
from routers.swagger.detector_params import checksv101_params

router = APIRouter()

@router.post( "/checks", openapi_extra=checksv101_params)
async def detector_checks_v1_0_1(request: Request):
    # Read raw image bytes
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty body, expected image bytes")

    # Read Request-Id (required in v1.0.1)
    request_id = request.headers.get("x-request-id")
    if not request_id:
        raise HTTPException(status_code=400, detail="Missing X-Request-Id header")

    user_id = request.headers.get("x-user-id", "unknown")

    try:
        verdict, confidence, label = predict_from_bytes(body)
        result = {
            "verdict": verdict,
            "label": label,
            "confidence": confidence
        }
        print(
            f"[Detector v1.0.1] Results: verdict={result['verdict']} "
            f"label={result['label']} confidence={result['confidence']}"
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Detector failure: {str(e)}")

    print(f"[Detector v1.0.1] request_id={request_id} user_id={user_id}")

    return JSONResponse(result)


