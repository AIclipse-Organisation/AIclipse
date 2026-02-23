import torch
from transformers import ViTForImageClassification, ViTImageProcessor, ViTConfig

from detector_modules.config.settings import (
    MODEL_DIR_V1,
    CHECKPOINT_PATH_V1,
    CLASS_NAMES_V1,
    DEVICE,
)


def load_v1_model():
    config = ViTConfig.from_pretrained(str(MODEL_DIR_V1))
    model = ViTForImageClassification(config)
    model.to(DEVICE)

    checkpoint = torch.load(CHECKPOINT_PATH_V1, map_location=DEVICE, weights_only=True)
    model.load_state_dict(checkpoint["model_state"], strict=False)
    model.eval()

    return model, CLASS_NAMES_V1