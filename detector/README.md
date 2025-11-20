# Detector Module

This module provides the deepfake detection pipeline. It exposes 
functions that accept image inputs and return a prediction.

## Inputs

- image bytes
- HTTP URL

## Outputs

A `(verdict, confidence, label)` tuple:
- `verdict`: string (`"real"` or `"ai"`)  
- `confidence`: float between 0 and 1 (smoothed confidence score)  
- `label`: readable string (e.g. `"89.23% Likely AI"`)

## Pipeline Overview

1. `decode_image`  
   Converts raw bytes → PIL Image.

2. `to_tensor`  
   Normalizes and converts image → Torch tensor.

3. `predict_probability`  
   Runs model inference and returns class probabilities.

4. `build_prediction`  
   Applies smoothing, determines verdict, and constructs the label.

5. Prediction interface  
   `predict_from_bytes()` and `predict_from_url()` wrap the above steps and exposes functionality to required routes.

---

## Functions

### From `predictor.py`

- `predict_from_bytes(image_bytes: bytes)`  
  entry point to model prediction which excepts image bytes and returns prediction tuple
  `(verdict, confidence, label)`.

- `predict_from_url(url: str)`  
  Downloads an image url and returns the prediction tuple.

- `_predict_from_image(img)`  
  expose prediction from model using img bytes.

### From `core/`

- `get_model()` – load versioned model  
- `to_tensor(img, device)` – preprocessing  
- `predict_probability(model, tensor)` – inference (prediction)  
- `build_prediction(probs, class_names)` – postprocessing

### From `io/`

- `decode_image(image_bytes)` – bytes to PIL Image  
- `fetch_image_bytes(url)` – download image from URL

### From `models/`

- `registry.py` – model registry which points to model directories by version
- `v1/loader.py` – loads model version and weights

### From `service/`
- `detector_service.py` – service which exposes the model to routes


# Testing
- Run 'python -m pytest tests -q' from inside /detector
- Tests all functionality for /detector-modules
