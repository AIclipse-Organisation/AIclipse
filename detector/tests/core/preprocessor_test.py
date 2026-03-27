import pytest
import tempfile
from pathlib import Path
import torch
from PIL import Image
import numpy as np

from detector_modules.core.preprocessor import load_image, to_tensor

@pytest.fixture
def temp_image():
    # Create a temporary image
    img = Image.fromarray(np.random.randint(0, 255, (100, 100, 3), dtype=np.uint8))
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img.save(tmp.name)
        yield Path(tmp.name)

def test_load_image(temp_image):
    # Test loading an image from file
    img = load_image(temp_image)
    assert isinstance(img, Image.Image)
    assert img.mode == "RGB"
    assert img.size == (100, 100)

def test_to_tensor_and_shape(tmp_path):

    img = Image.fromarray(np.random.randint(0, 255, (50, 50, 3), dtype=np.uint8))
    device = torch.device("cpu")
    
    tensor = to_tensor(img, device)
    
    # Check tensor shape: should be (1, 3, 224, 224)
    assert isinstance(tensor, torch.Tensor)
    assert tensor.shape == (1, 3, 224, 224)
