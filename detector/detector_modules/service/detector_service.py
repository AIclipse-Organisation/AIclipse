from detector_modules.core.loader import get_model
from detector_modules.core.preprocessor import to_tensor
from detector_modules.core.inferencer import predict_probability
from detector_modules.core.postprocessor import build_prediction
from detector_modules.io.fetcher import fetch_image_bytes
from detector_modules.io.decoder import decode_image


def _predict_from_image(img):
    model, class_names, device = get_model()
    tensor = to_tensor(img, device)
    probs = predict_probability(model, tensor)
    _, confidence, label = build_prediction(probs, class_names)
    return label, confidence


def predict_from_url(url: str):
    img_bytes = fetch_image_bytes(url)
    img = decode_image(img_bytes)
    return _predict_from_image(img)


def predict_from_bytes(image_bytes: bytes):
    img = decode_image(image_bytes)
    return _predict_from_image(img)