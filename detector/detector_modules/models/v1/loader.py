import torch
from transformers import ViTForImageClassification, ViTImageProcessor, ViTConfig
from safetensors.torch import load_file as load_safetensors

from detector_modules.config.settings import (
    MODEL_DIR_V1,
    CHECKPOINT_PATH_V1,
    CLASS_NAMES_V1,
    DEVICE,
)


def load_v1_model(override_path: str = None):
    # Always load architecture from the baked-in config
    config = ViTConfig.from_pretrained(str(MODEL_DIR_V1))
    model = ViTForImageClassification(config)
    
    path = override_path or str(CHECKPOINT_PATH_V1)
    
    print(f"[Loader] Loading weights from {path}")

    if path.endswith(".safetensors"):
        # Native Safetensors loading (Much faster and safer)
        state_dict = load_safetensors(path, device=str(DEVICE))
        model.load_state_dict(state_dict, strict=False)
    else:
        # Fallback for old .pt or .bin files
        # We set weights_only=False here only because the specific Pickler 
        # in your environment is throwing 'Unsupported operand 144'
        state_dict = torch.load(path, map_location=DEVICE, weights_only=False)
        
        # Unpack if nested in 'model_state'
        actual_weights = state_dict.get("model_state", state_dict)
        model.load_state_dict(actual_weights, strict=False)

    model.to(DEVICE)
    model.eval()

    return model, CLASS_NAMES_V1