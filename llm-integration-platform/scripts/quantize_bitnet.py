#!/usr/bin/env python3
"""BitNet quantization script.

Converts a HuggingFace model to BitNet-style ternary weights {-1, 0, 1}.
This implements a post-training quantization that simulates BitNet b1.58
by quantizing each weight tensor to ternary values using absmean scaling.

The output is a self-contained directory with:
  - Quantized model weights stored as float (ternary * scale) in safetensors
  - bitnet_meta.json with scale factors for dequantization and metadata
  - Tokenizer files for inference

Uses PYTHONPATH from env to find packages in isolated venv dir.
"""

import argparse
import json
import math
import os
import sys
import shutil

# Ensure our venv packages take priority
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
BITNET_VENV = os.path.join(PROJECT_DIR, "venvs", "bitnet")
if os.path.isdir(BITNET_VENV):
    sys.path.insert(0, BITNET_VENV)
    site_pkg = os.path.join(
        BITNET_VENV, "lib",
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


def ternary_quantize_tensor(weight, threshold_factor=0.5):
    """Quantize a weight tensor to {-1, 0, 1} using absmean scaling.

    This follows the BitNet b1.58 approach:
    1. Compute the mean absolute value (gamma) of the tensor
    2. Scale by threshold_factor to get the threshold
    3. Values above threshold -> +1
    4. Values below -threshold -> -1
    5. Values in between -> 0
    6. Store gamma as a scale factor for dequantization

    Returns (quantized_int8, scale_float) where:
    - quantized_int8 has dtype torch.int8 with values in {-1, 0, 1}
    - scale_float is a Python float for JSON serialization
    """
    import torch

    abs_mean = weight.abs().mean()
    threshold = abs_mean * threshold_factor

    quantized = torch.zeros_like(weight, dtype=torch.int8)
    quantized[weight > threshold] = 1
    quantized[weight < -threshold] = -1

    scale = abs_mean.item()
    # Ensure scale is JSON-serializable (handle inf/nan)
    if not math.isfinite(scale):
        scale = 0.0

    return quantized, scale


def count_ternary_distribution(quantized_int8):
    """Count the distribution of ternary values for reporting."""
    import torch
    total = quantized_int8.numel()
    n_pos = (quantized_int8 == 1).sum().item()
    n_neg = (quantized_int8 == -1).sum().item()
    n_zero = (quantized_int8 == 0).sum().item()
    return {
        "total": total,
        "positive": n_pos,
        "negative": n_neg,
        "zero": n_zero,
        "sparsity": round(n_zero / total, 4) if total > 0 else 0,
    }


def main():
    parser = argparse.ArgumentParser(description="BitNet Quantization")
    parser.add_argument("--model", required=True, help="HuggingFace repo ID")
    parser.add_argument("--bits", type=int, required=True, choices=[1],
                        help="Bit width (1 for ternary BitNet b1.58)")
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    is_local = os.path.isdir(args.model)
    model_name = os.path.basename(os.path.normpath(args.model)) if is_local else args.model.split("/")[-1]

    # Step 1: Download model (or use local path for finetuned models)
    if is_local:
        local_dir = args.model
        emit("progress", f"Using local model: {local_dir}", 0.20)
    else:
        emit("progress", f"Downloading {args.model} from HuggingFace...", 0.05)
        try:
            from huggingface_hub import snapshot_download
            work_dir = os.path.join(args.output_dir, "_work_bitnet")
            os.makedirs(work_dir, exist_ok=True)
            hf_model_dir = os.path.join(work_dir, "hf_model")
            if os.path.exists(hf_model_dir):
                shutil.rmtree(hf_model_dir)
            token = os.environ.get("HF_TOKEN") or None
            local_dir = snapshot_download(
                repo_id=args.model,
                local_dir=hf_model_dir,
                token=token,
            )
            emit("progress", f"Model downloaded to {local_dir}", 0.20)
        except Exception as e:
            emit("error", f"Failed to download model: {e}")
            sys.exit(1)

    # Step 2: Load model in FP32 for accurate quantization
    emit("progress", "Loading model for quantization...", 0.25)
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, AutoConfig

        config = AutoConfig.from_pretrained(local_dir, trust_remote_code=True)
        tokenizer = AutoTokenizer.from_pretrained(local_dir, trust_remote_code=True)

        model = AutoModelForCausalLM.from_pretrained(
            local_dir,
            dtype=torch.float32,
            device_map="cpu",
            trust_remote_code=True,
            low_cpu_mem_usage=True,
        )
        emit("progress", "Model loaded successfully", 0.35)
    except Exception as e:
        emit("error", f"Failed to load model: {e}")
        sys.exit(1)

    # Step 3: Quantize weight tensors to ternary
    emit("progress", "Quantizing weights to ternary {-1, 0, 1}...", 0.40)
    try:
        import torch

        scale_factors = {}
        total_params = 0
        quantized_params = 0
        total_sparsity = 0.0
        quantized_layers = 0
        param_names = list(model.named_parameters())
        num_params = len(param_names)

        for idx, (name, param) in enumerate(param_names):
            total_params += param.numel()
            progress_pct = 0.40 + (0.40 * (idx / num_params))

            # Only quantize weight matrices (not biases, norms, embeddings)
            if param.dim() >= 2 and "weight" in name and "norm" not in name.lower() and "embed" not in name.lower():
                quantized_int8, scale = ternary_quantize_tensor(param.data)

                # Store as float for transformers compatibility: scale * quantized
                # This preserves the ternary structure while being loadable
                param.data = quantized_int8.float() * scale

                scale_factors[name] = scale
                quantized_params += param.numel()

                # Track sparsity
                dist = count_ternary_distribution(quantized_int8)
                total_sparsity += dist["sparsity"]
                quantized_layers += 1

                if idx % max(1, num_params // 10) == 0:
                    emit("progress",
                         f"Quantized {idx}/{num_params} layers ({quantized_params:,} params)",
                         progress_pct)

        avg_sparsity = total_sparsity / quantized_layers if quantized_layers > 0 else 0

        # Effective bits: ternary is log2(3) = 1.58 bits, but with sparsity it's less
        effective_bits = 1.58 * (1 - avg_sparsity) + 0 * avg_sparsity  # 0 bits for zero values (run-length encoded)
        # Compression vs FP16 (16 bits per param)
        # Only quantized params use 1.58 bits; rest stay at original precision
        total_bits_original = total_params * 16  # FP16
        total_bits_quantized = (quantized_params * 1.58) + ((total_params - quantized_params) * 16)
        compression = (1.0 - total_bits_quantized / total_bits_original) * 100

        emit("progress",
             f"Quantized {quantized_params:,}/{total_params:,} parameters "
             f"(~{compression:.0f}% theoretical compression vs FP16, "
             f"avg sparsity: {avg_sparsity:.1%})", 0.80)
    except Exception as e:
        emit("error", f"Quantization failed: {e}")
        sys.exit(1)

    # Step 4: Save quantized model
    output_path = os.path.join(args.output_dir, f"{model_name}-bitnet-1bit")
    emit("progress", "Saving quantized model...", 0.85)
    try:
        model.save_pretrained(output_path, safe_serialization=True)
        tokenizer.save_pretrained(output_path)

        # Save scale factors and metadata (all values must be JSON-serializable)
        meta = {
            "method": "bitnet_b158",
            "bits": 1,
            "effective_bits_per_param": round(effective_bits, 3),
            "total_params": total_params,
            "quantized_params": quantized_params,
            "quantized_layers": quantized_layers,
            "avg_sparsity": round(avg_sparsity, 4),
            "theoretical_compression_vs_fp16": round(compression, 1),
            "scale_factors": {k: float(v) for k, v in scale_factors.items()},
            "original_model": args.model,
        }
        meta_path = os.path.join(output_path, "bitnet_meta.json")
        with open(meta_path, "w") as f:
            json.dump(meta, f, indent=2)

        emit("progress", "Model saved", 0.95)
    except Exception as e:
        emit("error", f"Failed to save model: {e}")
        sys.exit(1)

    # Step 5: Cleanup work directory
    try:
        if os.path.exists(work_dir):
            shutil.rmtree(work_dir)
    except Exception:
        pass  # Non-critical

    # Step 6: Report
    total_size = 0
    for root, dirs, files in os.walk(output_path):
        for f in files:
            total_size += os.path.getsize(os.path.join(root, f))
    size_mb = total_size / (1024 * 1024)

    obj = {
        "type": "complete",
        "message": (
            f"BitNet quantization complete: {model_name}-bitnet-1bit ({size_mb:.1f} MB). "
            f"{quantized_params:,} ternary params, {avg_sparsity:.0%} sparsity."
        ),
        "progress": 1.0,
        "file": os.path.basename(output_path),
    }
    print(json.dumps(obj), flush=True)


if __name__ == "__main__":
    main()
