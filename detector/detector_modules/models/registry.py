from detector_modules.models.v1.loader import load_v1_model

REGISTRY = {
    "v1": load_v1_model,
}