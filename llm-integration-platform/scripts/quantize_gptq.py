#!/usr/bin/env python3
"""GPTQ quantization script using AutoGPTQ.

Downloads a model from HuggingFace and quantizes using GPTQ
(post-training quantization). Supports 2/3/4/8-bit quantization.

Uses PYTHONPATH from env to find packages in isolated venv dir.
"""

import argparse
import json
import os
import sys

# Ensure our venv packages take priority over system packages
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
GPTQ_VENV = os.path.join(PROJECT_DIR, "venvs", "gptq")
if os.path.isdir(GPTQ_VENV):
    sys.path.insert(0, GPTQ_VENV)
    site_pkg = os.path.join(
        GPTQ_VENV, "lib",
        f"python{sys.version_info.major}.{sys.version_info.minor}",
        "site-packages"
    )
    if os.path.isdir(site_pkg):
        sys.path.insert(0, site_pkg)


def emit(msg_type, message, progress=None):
    """Emit a JSON progress line to stdout."""
    obj = {"type": msg_type, "message": message}
    if progress is not None:
        obj["progress"] = round(progress, 3)
    print(json.dumps(obj), flush=True)


CALIBRATION_TEXTS = [
    "The meaning of life is to find purpose and bring value to others through knowledge, creativity, and compassion.",
    "Machine learning models can be optimized through quantization, which reduces the precision of weights and activations.",
    "In computer science, algorithms are step-by-step procedures for calculations, data processing, and automated reasoning.",
    "The quick brown fox jumps over the lazy dog. This sentence contains every letter of the English alphabet.",
    "Artificial intelligence has transformed many industries, from healthcare diagnostics to autonomous vehicles.",
    "Python is a versatile programming language known for its readability and extensive library ecosystem.",
    "Deep learning neural networks consist of multiple layers that progressively extract higher-level features.",
    "Natural language processing enables computers to understand, interpret, and generate human language.",
    "Quantum computing leverages quantum mechanical phenomena like superposition and entanglement to process information.",
    "The transformer architecture revolutionized NLP by using self-attention mechanisms instead of recurrence.",
    "Reinforcement learning agents learn optimal strategies through trial and error interactions with their environment.",
    "Transfer learning allows models pre-trained on large datasets to be fine-tuned for specific downstream tasks.",
    "Convolutional neural networks are particularly effective for image recognition and computer vision tasks.",
    "Data preprocessing is a critical step that includes normalization, encoding, and handling missing values.",
    "Gradient descent optimization iteratively adjusts model parameters to minimize the loss function.",
    "Attention mechanisms allow neural networks to focus on relevant parts of the input when producing output.",
    "Large language models demonstrate emergent capabilities that scale with model size and training data.",
    "The softmax function converts raw logits into probability distributions over discrete output classes.",
    "Batch normalization stabilizes training by normalizing layer inputs, allowing higher learning rates.",
    "Dropout is a regularization technique that randomly deactivates neurons during training to prevent overfitting.",
    "The GPTQ algorithm uses approximate second-order information to achieve accurate post-training quantization.",
    "Tokenization breaks text into subword units that balance vocabulary size with representation granularity.",
    "Model distillation trains a smaller student network to mimic the behavior of a larger teacher model.",
    "Embedding layers map discrete tokens to dense continuous vector representations in high-dimensional space.",
    "Cross-entropy loss measures the difference between predicted probability distributions and true labels.",
    "The Adam optimizer combines momentum and adaptive learning rates for efficient gradient-based optimization.",
    "Beam search explores multiple candidate sequences simultaneously to find higher-quality text generations.",
    "Positional encodings inject sequence order information into transformer models that lack inherent ordering.",
    "Mixed precision training uses both FP16 and FP32 arithmetic to accelerate training while maintaining accuracy.",
    "Pruning removes redundant weights or neurons from neural networks to reduce model size and inference cost.",
    "Few-shot learning enables models to generalize from very limited examples by leveraging prior knowledge.",
    "The perceptron is the simplest neural network unit, computing a weighted sum followed by an activation function.",
]


def get_calibration_data(tokenizer, n_samples=128, seq_len=512):
    """Prepare calibration data in the format AutoGPTQ expects.

    Returns a list of dicts with 'input_ids' and 'attention_mask' tensors,
    each with shape [1, seq_len].
    """
    import torch

    samples = []
    # Repeat and cycle through calibration texts to reach n_samples
    for i in range(n_samples):
        text = CALIBRATION_TEXTS[i % len(CALIBRATION_TEXTS)]
        # Optionally combine multiple texts for longer sequences
        if seq_len > 128:
            # Combine 2-3 texts to fill longer sequences
            extra_idx = (i + 1) % len(CALIBRATION_TEXTS)
            text = text + " " + CALIBRATION_TEXTS[extra_idx]
            if seq_len > 256:
                extra_idx2 = (i + 2) % len(CALIBRATION_TEXTS)
                text = text + " " + CALIBRATION_TEXTS[extra_idx2]

        tokenized = tokenizer(
            text,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=seq_len,
        )
        samples.append({
            "input_ids": tokenized["input_ids"],
            "attention_mask": tokenized["attention_mask"],
        })

    return samples


def main():
    parser = argparse.ArgumentParser(description="GPTQ Quantization")
    parser.add_argument("--model", required=True, help="HuggingFace repo ID")
    parser.add_argument("--bits", type=int, required=True, choices=[2, 3, 4, 8])
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    model_name = args.model.split("/")[-1]

    # Step 1: Import and validate
    emit("progress", "Loading AutoGPTQ library...", 0.05)
    try:
        from transformers import AutoTokenizer
        emit("progress", "Transformers loaded", 0.07)
    except ImportError as e:
        emit("error", f"Transformers not installed: {e}")
        sys.exit(1)

    try:
        from auto_gptq import AutoGPTQForCausalLM, BaseQuantizeConfig
        emit("progress", "AutoGPTQ loaded successfully", 0.08)
    except ImportError as e:
        emit("error", f"AutoGPTQ not installed: {e}. Install with: pip install auto-gptq")
        sys.exit(1)

    # Step 2: Download and load model + tokenizer
    emit("progress", f"Downloading and loading {args.model}...", 0.10)
    try:
        token = os.environ.get("HF_TOKEN") or None
        tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True, token=token)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
            tokenizer.pad_token_id = tokenizer.eos_token_id
        emit("progress", "Tokenizer loaded", 0.15)

        quantize_config = BaseQuantizeConfig(
            bits=args.bits,
            group_size=128,
            desc_act=False,
            damp_percent=0.1,
        )

        model = AutoGPTQForCausalLM.from_pretrained(
            args.model,
            quantize_config,
            trust_remote_code=True,
            token=token,
        )
        emit("progress", "Model loaded successfully", 0.30)
    except Exception as e:
        emit("error", f"Failed to load model: {e}")
        sys.exit(1)

    # Step 3: Prepare calibration data with proper tensor shapes
    emit("progress", "Preparing calibration dataset...", 0.35)
    try:
        calibration_data = get_calibration_data(tokenizer, n_samples=128, seq_len=512)
        emit("progress", f"Calibration dataset ready ({len(calibration_data)} samples)", 0.38)
    except Exception as e:
        emit("error", f"Failed to prepare calibration data: {e}")
        sys.exit(1)

    # Step 4: Quantize
    emit("progress", f"Starting GPTQ {args.bits}-bit quantization (this may take several minutes)...", 0.40)
    try:
        model.quantize(calibration_data, batch_size=1)
        emit("progress", "Quantization complete", 0.80)
    except Exception as e:
        emit("error", f"Quantization failed: {e}")
        sys.exit(1)

    # Step 5: Save quantized model
    output_path = os.path.join(args.output_dir, f"{model_name}-gptq-{args.bits}bit")
    emit("progress", "Saving quantized model...", 0.85)
    try:
        model.save_quantized(output_path)
        tokenizer.save_pretrained(output_path)
        emit("progress", "Model saved", 0.95)
    except Exception as e:
        emit("error", f"Failed to save model: {e}")
        sys.exit(1)

    # Step 6: Report
    total_size = 0
    for root, dirs, files in os.walk(output_path):
        for f in files:
            total_size += os.path.getsize(os.path.join(root, f))
    size_mb = total_size / (1024 * 1024)

    obj = {
        "type": "complete",
        "message": f"Successfully quantized {model_name} with GPTQ {args.bits}-bit ({size_mb:.1f} MB total)",
        "progress": 1.0,
        "file": os.path.basename(output_path),
    }
    print(json.dumps(obj), flush=True)


if __name__ == "__main__":
    main()
