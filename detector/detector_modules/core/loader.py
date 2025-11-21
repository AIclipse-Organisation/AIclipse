from typing import Tuple
from detector_modules.config.settings import MODEL_VERSION, DEVICE
from detector_modules.models.registry import REGISTRY

model = None
class_names = None


def get_model() -> Tuple[object, tuple, object]:
    global model, class_names
    if model is None:
        loader_fn = REGISTRY.get(MODEL_VERSION)
        if loader_fn is None:
            raise ValueError(f"Unknown MODEL_VERSION: {MODEL_VERSION}")
        model, class_names = loader_fn()
    return model, class_names, DEVICE