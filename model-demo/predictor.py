import os
import torch
import math
from PIL import Image
from torchvision import transforms
from transformers import ViTForImageClassification, ViTImageProcessor, ViTConfig


class DeepfakeModel:
    def __init__(self,
                 model_dir="static/model/pretrained_model_backup_20251012_193129",
                 checkpoint_path="static/model/Phase1_20pct_best.pt",
                 class_names=("FAKE", "REAL")):
        self.model_dir = model_dir
        self.checkpoint_path = checkpoint_path
        self.class_names = class_names
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        self.transform = transforms.Compose([
            transforms.Resize((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406],
                                 [0.229, 0.224, 0.225])
        ])

        self.processor = ViTImageProcessor.from_pretrained(self.model_dir)
        config = ViTConfig.from_pretrained(self.model_dir)
        self.model = ViTForImageClassification(config)
        self.model.to(self.device)

        checkpoint = torch.load(self.checkpoint_path, map_location=self.device)
        self.model.load_state_dict(checkpoint["model_state"], strict=False)
        self.model.eval()
        
    def get_confidence_label(self, verdict: str, confidence: float):
        pct = confidence * 100
        is_fake = verdict.upper() == "FAKE"

        if pct < 15 or pct > 85:
            label = "Highly Likely Fake" if is_fake else "Highly Unlikely Fake"
        elif 15 <= pct < 40 or 60 < pct <= 85:
            label = "Likely Fake" if is_fake else "Unlikely Fake"
        else:  # 40–60 range
            label = "Not Sure"

        return f"{pct:.2f}% {label}"
    
    #Soft cap with sigmoid remap
    def smooth_confidence(self,confidence):
        k = 4
        return 1 / (1 + math.exp(-k * (confidence - 0.5)))

    def predict(self, image_path):
        img = Image.open(image_path).convert("RGB")
        input_tensor = self.transform(img).unsqueeze(0).to(self.device)

        with torch.no_grad():
            outputs = self.model(input_tensor)
            probs = torch.softmax(outputs.logits, dim=1).cpu().numpy()[0]

        pred_idx = probs.argmax()
        verdict = self.class_names[pred_idx]
        confidence = float(probs[pred_idx])

        # apply smoothing before label generation
        confidence = self.smooth_confidence(confidence)
        label = self.get_confidence_label(verdict, confidence)

        print(f"{confidence:.3f} smoothed | {label} label")
        return confidence, label





model_instance = DeepfakeModel()


def predict_image(image_path):
    confidence, label = model_instance.predict(image_path)
    return label, confidence


