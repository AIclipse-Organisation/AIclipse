import torch
import numpy as np
from detector_modules.core.inferencer import predict_probability


class DummyModel:
    def __call__(self, tensor):
        return type("O", (), {"logits": torch.tensor([[1.0, 2.0]])})

def test_predict_probability():
    model = DummyModel()
    x = torch.zeros((1, 3, 224, 224))
    probs = predict_probability(model, x)

    #Check that probability is instance of np.ndarray
    assert isinstance(probs, np.ndarray)
    #Check for shape of probability i.e. is 2 length array
    assert probs.shape == (2,)
    #Check for probs total valye between 0 and 1
    assert abs(probs.sum() - 1) < 1e-5