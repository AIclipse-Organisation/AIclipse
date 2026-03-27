from typing import Union
from pathlib import Path

from PIL import Image
from torchvision import transforms
import torch


_transform = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
    transforms.Normalize(
        [0.485, 0.456, 0.406],
        [0.229, 0.224, 0.225],
    ),
])


def load_image(image_path: Union[str, Path]) -> Image.Image:
    return Image.open(image_path).convert("RGB")


def to_tensor(img: Image.Image, device: torch.device) -> torch.Tensor:
    return _transform(img).unsqueeze(0).to(device)