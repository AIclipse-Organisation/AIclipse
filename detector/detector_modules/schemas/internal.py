from pydantic import BaseModel

class ModelUpdateRequest(BaseModel):
    version: str
    minio_path: str