from detector_modules.core.postprocessor import smooth_confidence,get_confidence_label,build_prediction
import numpy as np
 
def test_smooth_confidence():
    # Test that the function outputs values between 0 and 1
    for conf in [0.0, 0.25, 0.5, 0.75, 1.0]:
        smoothed = smooth_confidence(conf)
        assert 0 <= smoothed <= 1

def test_get_confidence_label():
    # Fake verdicts for testing
    verdict_fake = "FAKE"
    verdict_real = "REAL"

    # low confidence
    label = get_confidence_label(verdict_fake, 0.1)
    assert "Highly Likely Fake" in label
    label = get_confidence_label(verdict_real, 0.1)
    assert "Highly Unlikely Fake" in label

    # high confidence
    label = get_confidence_label(verdict_fake, 0.9)
    assert "Highly Likely Fake" in label
    label = get_confidence_label(verdict_real, 0.9)
    assert "Highly Unlikely Fake" in label

    # middle confidence
    label = get_confidence_label(verdict_fake, 0.5)
    assert "Not Sure" in label
    label = get_confidence_label(verdict_real, 0.5)
    assert "Not Sure" in label

    # boundary conditions
    label = get_confidence_label(verdict_fake, 0.14)
    assert "Highly Likely Fake" in label
    label = get_confidence_label(verdict_real, 0.86)
    assert "Highly Unlikely Fake" in label
    label = get_confidence_label(verdict_fake, 0.16)
    assert "Likely Fake" in label
    label = get_confidence_label(verdict_real, 0.84)
    assert "Unlikely Fake" in label
    label = get_confidence_label(verdict_fake, 0.45)
    assert "Not Sure" in label
    label = get_confidence_label(verdict_real, 0.55)
    assert "Not Sure" in label

def test_build_prediction():
    # Example probability array
    probs = np.array([0.1, 0.9])
    class_names = ("Real", "Fake")

    verdict, confidence, label = build_prediction(probs, class_names)
    assert verdict in class_names
    assert 0 <= confidence <= 1

    # Test with different probabilities
    probs = np.array([0.8, 0.2])
    verdict, confidence, label = build_prediction(probs, class_names)
    assert verdict == "Real"
    assert 0 <= confidence <= 1