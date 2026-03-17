import math
import numpy as np


def smooth_confidence(confidence: float) -> float:
    # Soft cap with sigmoid remap around 0.5
    k = 4
    return 1 / (1 + math.exp(-k * (confidence - 0.5)))


def get_confidence_label(verdict: str, confidence: float) -> str:
    pct = confidence * 100
    is_fake = verdict.upper() == "FAKE"

    if pct < 15 or pct > 85:
        label = "Highly Likely Fake" if is_fake else "Highly Unlikely Fake"
    elif 15 <= pct < 40 or 60 < pct <= 85:
        label = "Likely Fake" if is_fake else "Unlikely Fake"
    else:  # 40–60 range
        label = "Not Sure"

    return f"{pct:.2f}% {label}"


def build_prediction(probs: np.ndarray, class_names: tuple):
    pred_idx = int(probs.argmax())
    verdict = class_names[pred_idx]
    raw_confidence = float(probs[pred_idx])

    confidence = smooth_confidence(raw_confidence)
    label = get_confidence_label(verdict, confidence)

    print(f"{confidence:.3f} smoothed | {label} label")
    return verdict, confidence, label