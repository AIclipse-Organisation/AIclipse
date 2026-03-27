import os
import sys
import json
import argparse
import gc
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split, Dataset
from torchvision import transforms
from torchvision.datasets import ImageFolder
from transformers import ViTForImageClassification, ViTImageProcessor
from torch.optim import AdamW
from sklearn.metrics import precision_score, recall_score, f1_score, confusion_matrix

# ==============================
# CONFIG & ARGUMENTS
# ==============================
def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data_dir", type=str, required=True)
    parser.add_argument("--golden_dir", type=str, required=True)
    parser.add_argument("--base_model_path", type=str, required=True)
    parser.add_argument("--output_dir", type=str, required=True)
    
    parser.add_argument("--epochs", type=int, default=5)
    parser.add_argument("--lr", type=float, default=2e-6)
    # Lowered default batch size slightly to be safer on 2Gi limits
    parser.add_argument("--batch_size", type=int, default=8) 
    
    return parser.parse_args()

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

# ==============================
# DATASET WRAPPER (Fixes Transform Bug)
# ==============================
class ApplyTransform(Dataset):
    """
    Safely applies a specific transform to a dataset subset without 
    mutating the original dataset's transform.
    """
    def __init__(self, subset, transform):
        self.subset = subset
        self.transform = transform

    def __len__(self):
        return len(self.subset)

    def __getitem__(self, idx):
        # Get raw image (PIL) and label, then apply the specific transform
        img, label = self.subset[idx]
        return self.transform(img), label

def compute_metrics(preds, labels):
    preds = np.array(preds)
    labels = np.array(labels)
    
    acc = (preds == labels).mean()
    prec = precision_score(labels, preds, zero_division=0)
    rec = recall_score(labels, preds, zero_division=0)
    f1 = f1_score(labels, preds, zero_division=0)
    
    fake_to_real, real_to_fake = 0, 0
    try:
        cm = confusion_matrix(labels, preds, labels=[0, 1]) 
        fake_to_real = int(cm[0][1]) 
        real_to_fake = int(cm[1][0]) 
    except Exception:
        pass

    return {
        "accuracy": float(acc),
        "precision": float(prec),
        "recall": float(rec),
        "f1_score": float(f1),
        "misclass_fake_to_real": fake_to_real,
        "misclass_real_to_fake": real_to_fake
    }

# ==============================
# OPTIMIZED EVALUATION LOOP
# ==============================
def evaluate(model, loader):
    model.eval()
    all_preds = []
    all_labels = []
    
    with torch.no_grad():
        for batch in loader:
            x, y = batch
            x, y = x.to(device), y.to(device)
                
            logits = model(x).logits
            preds = logits.argmax(dim=1).cpu().numpy()
            labels = y.cpu().numpy()
            
            all_preds.extend(preds)
            all_labels.extend(labels)
            
            # MEMORY OPTIMIZATION: Explicitly clear tensors to free RAM instantly
            del x, y, logits, preds, labels, batch
    
    # Force garbage collection after the loop completes
    gc.collect()
    return compute_metrics(all_preds, all_labels)

# ==============================
# MAIN LOOP
# ==============================
def main():
    args = parse_args()

    # 1. AUTO-FIX: DETECT AND REPAIR MODEL FILES
    bad_path = os.path.join(args.base_model_path, "model.safetensors")
    correct_path = os.path.join(args.base_model_path, "pytorch_model.bin")
    load_target_path = correct_path
    
    if os.path.exists(bad_path):
        try:
            with open(bad_path, 'rb') as f:
                header = f.read(2)
            if header == b'PK':
                print(f"[Auto-Fix] File '{bad_path}' is actually a ZIP. Renaming.")
                os.rename(bad_path, correct_path)
            else:
                load_target_path = bad_path
        except Exception as e:
            print(f"[Auto-Fix] Warning checking header: {e}")

    if os.path.exists(load_target_path) and load_target_path.endswith(".bin"):
        try:
            print(f"[Auto-Fix] Inspecting '{load_target_path}'...")
            state_dict = torch.load(load_target_path, map_location="cpu")
            if "model_state" in state_dict:
                print("[Auto-Fix] Unpacking nested weights...")
                torch.save(state_dict["model_state"], load_target_path)
            
            # Free memory immediately
            del state_dict
            gc.collect() 
        except Exception as e:
            print(f"[Auto-Fix] Error unpacking: {e}")

    # 2. LOAD MODEL & PROCESSOR
    print(f"Loading base model from {args.base_model_path}...")
    model = ViTForImageClassification.from_pretrained(args.base_model_path)
    processor = ViTImageProcessor.from_pretrained(args.base_model_path)
    model.to(device)
    
    train_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(brightness=0.1, contrast=0.1),
        transforms.ToTensor(),
        transforms.Normalize(mean=processor.image_mean, std=processor.image_std)
    ])
    
    eval_transform = transforms.Compose([
        transforms.Resize((224, 224)),
        transforms.ToTensor(),
        transforms.Normalize(mean=processor.image_mean, std=processor.image_std)
    ])

    # 3. LOAD DATASETS (Using the fixed wrapper)
    print(f"Loading training data from {args.data_dir}")
    # Load without transforms first so we can wrap them safely
    raw_dataset = ImageFolder(args.data_dir) 
    
    train_size = int(0.8 * len(raw_dataset))
    val_size = len(raw_dataset) - train_size
    raw_train_ds, raw_val_ds = random_split(raw_dataset, [train_size, val_size])
    
    # Apply correct transforms independently
    train_ds = ApplyTransform(raw_train_ds, train_transform)
    val_ds = ApplyTransform(raw_val_ds, eval_transform)

    # Load Golden Set
    print(f"Loading golden test set from {args.golden_dir}")
    raw_golden = ImageFolder(args.golden_dir)
    golden_ds = ApplyTransform(raw_golden, eval_transform)

    # 4. DATA LOADERS
    train_loader = DataLoader(train_ds, batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size)
    golden_loader = DataLoader(golden_ds, batch_size=args.batch_size)

    print(f"Training on {len(train_ds)} images. Validating on {len(val_ds)}. Golden Set: {len(golden_ds)}")

    # 5. TRAINING LOOP
    optimizer = AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    criterion = nn.CrossEntropyLoss()
    
    model.train()
    print("Starting fine tuning")
    
    for epoch in range(args.epochs):
        total_loss = 0
        for batch_idx, (images, labels) in enumerate(train_loader):
            images, labels = images.to(device), labels.to(device)
            
            optimizer.zero_grad()
            outputs = model(images)
            loss = criterion(outputs.logits, labels)
            loss.backward()
            optimizer.step()
            
            total_loss += loss.item()
            
            # MEMORY OPTIMIZATION: Clear graph and buffers from loop
            del images, labels, outputs, loss
        
        # Clear RAM between epochs
        gc.collect()
        avg_loss = total_loss / len(train_loader)
        print(f"Epoch {epoch+1}/{args.epochs} - Loss: {avg_loss:.4f}")

    # 6. EVALUATION
    print("Evaluating model performance...")
    val_metrics = evaluate(model, val_loader)
    golden_metrics = evaluate(model, golden_loader)
    
    print(f"Validation Acc: {val_metrics['accuracy']:.4f}")
    print(f"Golden Set Acc: {golden_metrics['accuracy']:.4f}")

    # 7. SAVE ARTIFACTS
    print(f"Saving to {args.output_dir}.")
    os.makedirs(args.output_dir, exist_ok=True)
    model.save_pretrained(args.output_dir)
    processor.save_pretrained(args.output_dir)
    
    final_metrics = {
        "validation": val_metrics,
        "golden_test": golden_metrics,
        "epochs_trained": args.epochs,
        "dataset_size": len(raw_dataset)
    }
    
    with open(os.path.join(args.output_dir, "metrics.json"), "w") as f:
        json.dump(final_metrics, f, indent=4)

    print("Training complete")

if __name__ == "__main__":
    main()