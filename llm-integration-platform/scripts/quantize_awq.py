#!/usr/bin/env python3
"""AWQ quantization script using AutoAWQ.

Downloads a model from HuggingFace and quantizes using AWQ.
Uses PYTHONPATH from env to find packages in isolated venv dir.
"""

import argparse
import json
import os
import sys

# Ensure our venv packages take priority over system packages
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
AWQ_VENV = os.path.join(PROJECT_DIR, "venvs", "awq")
if os.path.isdir(AWQ_VENV):
    sys.path.insert(0, AWQ_VENV)

def emit(msg_type, message, progress=None):
    """Emit a JSON progress line to stdout."""
    obj = {"type": msg_type, "message": message}
    if progress is not None:
        obj["progress"] = round(progress, 3)
    print(json.dumps(obj), flush=True)

def main():
    parser = argparse.ArgumentParser(description="AWQ Quantization")
    parser.add_argument("--model", required=True, help="HuggingFace repo ID")
    parser.add_argument("--bits", type=int, required=True, choices=[4, 8])
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    model_name = args.model.split("/")[-1]

    # Step 1: Import and validate
    emit("progress", "Loading AutoAWQ library...", 0.05)
    try:
        import torch
        from awq import AutoAWQForCausalLM
        from transformers import AutoTokenizer
        emit("progress", "AutoAWQ loaded successfully", 0.08)
    except ImportError as e:
        emit("error", f"AutoAWQ not installed: {e}. Install with: pip install autoawq")
        sys.exit(1)

    # CUDA check
    if not torch.cuda.is_available():
        emit("error", "AWQ quantization requires a CUDA GPU. No GPU detected.")
        sys.exit(1)

    # Clear CUDA memory before starting
    import gc
    gc.collect()
    torch.cuda.empty_cache()
    gpu_mem = torch.cuda.get_device_properties(0).total_memory / (1024**3)
    emit("progress", f"GPU: {torch.cuda.get_device_name(0)} ({gpu_mem:.0f} GB)", 0.06)

    # Step 2: Download and load model
    emit("progress", f"Downloading and loading {args.model}...", 0.10)
    try:
        token = os.environ.get("HF_TOKEN") or None
        model = AutoAWQForCausalLM.from_pretrained(args.model, token=token)
        tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True, token=token)
        emit("progress", "Model loaded successfully", 0.30)
    except Exception as e:
        err_msg = str(e)
        if "out of memory" in err_msg.lower() or "oom" in err_msg.lower():
            emit("error", f"GPU out of memory loading model. Try a smaller model or free GPU memory.")
        elif "does not appear to have" in err_msg.lower() or "not a valid model" in err_msg.lower():
            emit("error", f"Model {args.model} is not compatible with AWQ quantization: {err_msg}")
        else:
            emit("error", f"Failed to load model: {err_msg}")
        sys.exit(1)

    # Step 3: Configure and run quantization
    quant_config = {
        "zero_point": True,
        "q_group_size": 128,
        "w_bit": args.bits,
        "version": "GEMM",
        "modules_to_not_convert": [],
    }
    emit("progress", f"Starting AWQ {args.bits}-bit quantization (this may take several minutes)...", 0.35)

    try:
        model.quantize(tokenizer, quant_config=quant_config)
        emit("progress", "Quantization complete", 0.80)
    except torch.cuda.OutOfMemoryError:
        emit("error", "GPU ran out of memory during quantization. Try a smaller model or lower batch size.")
        sys.exit(1)
    except Exception as e:
        err_msg = str(e)
        if "out of memory" in err_msg.lower():
            emit("error", f"GPU out of memory during quantization. Try a smaller model.")
        else:
            emit("error", f"Quantization failed: {err_msg}")
        sys.exit(1)

    # Step 4: Save quantized model
    output_path = os.path.join(args.output_dir, f"{model_name}-awq-{args.bits}bit")
    emit("progress", f"Saving quantized model...", 0.85)
    try:
        model.save_quantized(output_path)
        tokenizer.save_pretrained(output_path)
        emit("progress", "Model saved", 0.95)
    except Exception as e:
        emit("error", f"Failed to save model: {e}")
        sys.exit(1)
    finally:
        # Cleanup GPU memory
        del model
        gc.collect()
        torch.cuda.empty_cache()

    # Step 5: Report
    total_size = 0
    for root, dirs, files in os.walk(output_path):
        for f in files:
            total_size += os.path.getsize(os.path.join(root, f))
    size_mb = total_size / (1024 * 1024)

    obj = {
        "type": "complete",
        "message": f"Successfully quantized {model_name} with AWQ {args.bits}-bit ({size_mb:.1f} MB total)",
        "progress": 1.0,
        "file": os.path.basename(output_path),
    }
    print(json.dumps(obj), flush=True)

if __name__ == "__main__":
    main()
