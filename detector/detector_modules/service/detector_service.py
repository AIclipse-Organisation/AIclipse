from detector_modules.core.loader import get_model
from detector_modules.core.preprocessor import to_tensor
from detector_modules.core.inferencer import predict_probability
from detector_modules.core.postprocessor import build_prediction
from detector_modules.io.fetcher import fetch_image_bytes
from detector_modules.io.decoder import decode_image


def predict_from_url(url: str):
    model, class_names, device = get_model()

    img_bytes = fetch_image_bytes(url)

    img = decode_image(img_bytes)

    tensor = to_tensor(img, device)

    probs = predict_probability(model, tensor)

    _, confidence, label = build_prediction(probs, class_names)

    return label, confidence
