from detector_modules.core.postprocessor import smooth_confidence,get_confidence_label,build_prediction
import numpy as np
 
def test_smooth_confidence():
    # Test that the function outputs values between 0 and 1
    for conf in [0.0, 0.25, 0.5, 0.75, 1.0]:
        smoothed = smooth_confidence(conf)
        assert 0 <= smoothed <= 1

def test_get_confidence_label():
    # low confidence (<15%)
    assert get_confidence_label("FAKE", 0.1) == "fake"
    assert get_confidence_label("REAL", 0.1) == "real"

    # high confidence (>85%)
    assert get_confidence_label("FAKE", 0.9) == "fake"
    assert get_confidence_label("REAL", 0.9) == "real"

    # middle confidence (40–60%) — suspicious regardless of verdict
    assert get_confidence_label("FAKE", 0.5) == "suspicious"
    assert get_confidence_label("REAL", 0.5) == "suspicious"

    # boundary: just below 15%
    assert get_confidence_label("FAKE", 0.14) == "fake"
    assert get_confidence_label("REAL", 0.14) == "real"

    # boundary: just above 85%
    assert get_confidence_label("FAKE", 0.86) == "fake"
    assert get_confidence_label("REAL", 0.86) == "real"

    # mid-low range (15–40%)
    assert get_confidence_label("FAKE", 0.16) == "fake"
    assert get_confidence_label("REAL", 0.16) == "real"

    # mid-high range (60–85%)
    assert get_confidence_label("FAKE", 0.84) == "fake"
    assert get_confidence_label("REAL", 0.84) == "real"

    # within suspicious range
    assert get_confidence_label("FAKE", 0.45) == "suspicious"
    assert get_confidence_label("REAL", 0.55) == "suspicious"

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