import pytest
from detector_modules.core import loader

def test_get_model_loads_from_manager(monkeypatch):
    fake_model_obj = "FAKE_MODEL_INSTANCE"
    fake_classes = ("real", "ai")

    def fake_loader_fn(checkpoint_path=None):
        return fake_model_obj, fake_classes

    monkeypatch.setattr("detector_modules.core.loader.REGISTRY", {"v1": fake_loader_fn})
    monkeypatch.setattr("detector_modules.core.loader.MODEL_VERSION", "v1")

    monkeypatch.setattr(loader.manager, "_model", None)
    monkeypatch.setattr(loader.manager, "_class_names", None)

    model, classes, device = loader.get_model()

    assert model == "FAKE_MODEL_INSTANCE"
    assert classes == ("real", "ai")
    assert device is loader.DEVICE

def test_manager_reload_with_custom_path(monkeypatch):
    """Verifies that the reload method correctly passes the checkpoint path to the loader"""
    
    received_path = []

    def fake_loader_fn(path):
        received_path.append(path)
        return "MODEL", ("a", "b")

    monkeypatch.setattr("detector_modules.core.loader.REGISTRY", {"v1": fake_loader_fn})
    monkeypatch.setattr("detector_modules.core.loader.MODEL_VERSION", "v1")
    
    # Trigger a reload with a specific path
    test_path = "/tmp/new_weights.pt"
    loader.manager.reload(checkpoint_path=test_path)

    assert received_path[0] == test_path