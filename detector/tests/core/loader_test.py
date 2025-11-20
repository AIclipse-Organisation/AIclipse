from detector_modules.core import loader

def test_get_model_loads_from_registry(monkeypatch):
    # Fake model + classes
    def fake_loader():
        return "FAKE_MODEL", ("real", "fake")

    # Set registry and model version
    monkeypatch.setattr(loader, "REGISTRY", {"v1": fake_loader})
    monkeypatch.setattr(loader, "MODEL_VERSION", "v1")

    # Reset cached model
    monkeypatch.setattr(loader, "model", None)
    monkeypatch.setattr(loader, "class_names", None)

    model, classes, device = loader.get_model()

    assert model == "FAKE_MODEL"
    assert classes == ("real", "fake")
    assert device is loader.DEVICE