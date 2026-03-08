import threading
from typing import Tuple, Optional
import logging
from detector_modules.config.settings import MODEL_VERSION, DEVICE
from detector_modules.models.registry import REGISTRY
from pathlib import Path

logger = logging.getLogger(__name__)

class ModelManager:
    def __init__(self):
        self._model = None
        self._class_names = None
        self._lock = threading.Lock()

    def get_current(self) -> Tuple[object, tuple, object]:
        with self._lock:
            if self._model is None:
                # Force initial load
                self.reload()
            return self._model, self._class_names, DEVICE

    def reload(self, checkpoint_path: Optional[str] = None):
        """
        Swaps the model in memory. 
        If checkpoint_path fails, it self-heals by falling back to base weights.
        """
        loader_fn = REGISTRY.get(MODEL_VERSION)
        if loader_fn is None:
            raise ValueError(f"Unknown MODEL_VERSION: {MODEL_VERSION}")
        
        try:
            # Attempt to load the specific path (or default path if None)
            new_model, new_classes = loader_fn(checkpoint_path)
            
            with self._lock:
                self._model = new_model
                self._class_names = new_classes
            
            logger.info(f"Model successfully loaded from: {checkpoint_path or 'Base Model'}")

        except Exception as e:
            logger.error(f"Failed to load model from {checkpoint_path}: {e}")

            # WORKAROUND: If the specific update file is corrupt or incompatible
            if checkpoint_path and "updates" in str(checkpoint_path):
                logger.warning(f"Corrupted or invalid update detected at {checkpoint_path}. Cleaning up...")
                
                # Delete the bad file so it doesn't break future boots
                try:
                    p = Path(checkpoint_path)
                    if p.exists():
                        p.unlink()
                        logger.info(f"Deleted bad weights file: {p.name}")
                except Exception as cleanup_err:
                    logger.error(f"Failed to delete bad file: {cleanup_err}")

                logger.info("Attempting fallback to original base weights...")
                self.reload(None)
            else:
                # If we are already trying to load the base model and it fails, 
                # then the Docker image itself is broken.
                raise RuntimeError("Critical Error: Even base model weights failed to load.")

def cleanup_old_models(active_model_path: str):
    """
    Scans the updates directory and deletes any .pt or .safetensors 
    files that are not the currently active model.
    """
    if not active_model_path:
        return

    try:
        active_path_obj = Path(active_model_path).resolve()
        updates_dir = Path(__file__).resolve().parents[2] / "models" / "updates"

        if not updates_dir.exists():
            return

        # Target both old PyTorch and new Safetensors formats
        patterns = ["*.pt", "*.safetensors", "*.bin"]
        for pattern in patterns:
            for file_path in updates_dir.glob(pattern):
                file_path_obj = file_path.resolve()
                
                if file_path_obj != active_path_obj:
                    try:
                        file_path_obj.unlink()
                        logger.info(f"Disk Cleanup: Deleted old model '{file_path_obj.name}'")
                    except OSError as e:
                        logger.warning(f"Disk Cleanup: Could not delete '{file_path_obj.name}': {e}")
                        
    except Exception as e:
        logger.error(f"Disk Cleanup: Critical failure during execution: {e}")

manager = ModelManager()

def get_model():
    return manager.get_current()