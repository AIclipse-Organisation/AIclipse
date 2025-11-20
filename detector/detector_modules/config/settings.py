import os
from pathlib import Path
import torch

BASE_DIR = Path(__file__).resolve().parents[1]

MODEL_VERSION = os.getenv("MODEL_VERSION", "v1")

MODEL_DIR_V1 = (
    BASE_DIR
    / "models"
    / "v1"
    / "pretrained_model_backup_20251012_193129"
)
CHECKPOINT_PATH_V1 = BASE_DIR / "models" / "v1" / "weights.pt"

CLASS_NAMES_V1 = ("FAKE", "REAL")

DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")