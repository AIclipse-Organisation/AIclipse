import torch
import numpy as np


def predict_probability(model, input_tensor):
    with torch.no_grad():
        outputs = model(input_tensor)
        probs = torch.softmax(outputs.logits, dim=1).cpu().numpy()[0]
    return probs