import threading
from typing import Tuple
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
                self.reload()
            return self._model, self._class_names, DEVICE

    def reload(self, checkpoint_path: str = None):
        """
        Swaps the model in memory. 
        If checkpoint_path is provided, it overrides the default setting.
        """
        loader_fn = REGISTRY.get(MODEL_VERSION)
        if loader_fn is None:
            raise ValueError(f"Unknown MODEL_VERSION: {MODEL_VERSION}")
        
        new_model, new_classes = loader_fn(checkpoint_path)
        
        with self._lock:
            self._model = new_model
            self._class_names = new_classes
       
            
def cleanup_old_models(active_model_path: str):
    """
    Scans the updates directory and deletes any .pt files that are not the currently active model.
    """
    if not active_model_path:
        return

    try:
        active_path_obj = Path(active_model_path).resolve()
        
        updates_dir = Path(__file__).resolve().parents[2] / "models" / "updates"

        if not updates_dir.exists():
            return

        for file_path in updates_dir.glob("*.pt"):
            file_path_obj = file_path.resolve()
            
            # If the file isn't the one we just loaded, delete it
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