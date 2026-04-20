# detector_modules/io/minio_client.py
import os
import logging
import boto3
from botocore.exceptions import ClientError
from botocore.config import Config
from pathlib import Path

logger = logging.getLogger(__name__)
_SUPPORTED_MODEL_EXTENSIONS = {".pt", ".bin", ".safetensors"}

def _get_s3_client_and_bucket():
    endpoint = os.getenv("S3_ENDPOINT", "http://minio:9000")
    if not endpoint.startswith("http"):
        endpoint = f"http://{endpoint}"

    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    bucket_name = os.getenv("MINIO_BUCKET_NAME", "model-cycle-storage") 

    s3_cfg = Config(signature_version="s3v4", s3={"addressing_style": "path"})

    s3_client = boto3.client(
        's3',
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="us-east-1",
        config=s3_cfg
    )
    return s3_client, bucket_name

def download_model_weights(object_key: str, version: str) -> str:
    """Downloads specific model weights from MinIO."""
    s3_client, bucket_name = _get_s3_client_and_bucket()
    
    local_dir = Path(__file__).resolve().parents[2] / "models" / "updates"
    local_dir.mkdir(parents=True, exist_ok=True)
    extension = Path(object_key).suffix or ".pt"
    local_file_path = local_dir / f"{version}{extension}"
    
    try:
        logger.info(f"[Boto3] Downloading '{object_key}' from bucket '{bucket_name}' to '{local_file_path}'")
        s3_client.download_file(bucket_name, object_key, str(local_file_path))
        logger.info(f"[Boto3] Successfully downloaded '{object_key}'")
        return str(local_file_path)
    except ClientError as e:
        logger.error(f"[Boto3] Failed to download '{object_key}' from bucket '{bucket_name}': {e}")
        if local_file_path.exists():
            local_file_path.unlink() 
        raise

def fetch_latest_model_from_minio() -> str | None:
    """
    Checks MinIO for the most recently uploaded model. 
    If found, downloads it and returns the local path. 
    If not found or error occurs, returns None.
    """
    s3_client, bucket_name = _get_s3_client_and_bucket()
    
    try:
        response = s3_client.list_objects_v2(Bucket=bucket_name, Prefix="models/")
        
        if 'Contents' not in response or not response['Contents']:
            logger.info("[Boto3] No models found in MinIO. Will use local default model.")
            return None

        objects = [
            obj for obj in response['Contents']
            if _is_canonical_model_key(obj.get('Key', ''))
        ]
        if not objects:
            logger.info("[Boto3] No canonical models found in MinIO. Will use local default model.")
            return None

        # Sort objects by LastModified date to find the newest canonical model
        latest_obj = max(objects, key=lambda obj: obj['LastModified'])
        
        object_key = latest_obj['Key']
        
        # Extract version from key (e.g., "models/v2.pt" -> "v2")
        version = Path(object_key).stem 
        
        logger.info(f"[Boto3] Found latest model in MinIO: {object_key} (Last Modified: {latest_obj['LastModified']})")
        
        return download_model_weights(object_key, version)
        
    except Exception as e:
        logger.warning(f"[Boto3] Could not fetch latest model from MinIO, falling back to local: {e}")
        return None


def _is_canonical_model_key(object_key: str) -> bool:
    if not object_key.startswith("models/"):
        return False

    relative_key = object_key[len("models/"):]
    if "/" in relative_key:
        return False

    return Path(relative_key).suffix.lower() in _SUPPORTED_MODEL_EXTENSIONS
