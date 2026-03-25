#!/usr/bin/env python3
"""AWQ inference script with streaming.

Loads an AWQ-quantized model and streams generated tokens as JSON lines.

Output format:
  {"type":"token","text":"..."}
  {"type":"done","tokens_generated":N,"time_ms":M,"tokens_per_sec":X}
"""

import argparse
import json
import os
import sys
import time
import threading
import sysconfig

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
AWQ_VENV = os.path.join(PROJECT_DIR, "venvs", "awq")

# Fix Python headers for Triton compilation
_pydev_inc = sysconfig.get_path('include')
if _pydev_inc and os.path.isdir(_pydev_inc):
    os.environ.setdefault("CPATH", _pydev_inc)

if os.path.isdir(AWQ_VENV):
    sys.path.insert(0, AWQ_VENV)
    site_pkg = os.path.join(AWQ_VENV, "lib", f"python{sys.version_info.major}.{sys.version_info.minor}", "site-packages")
    if os.path.isdir(site_pkg):
        sys.path.insert(0, site_pkg)


def emit(msg_type, **kwargs):
    obj = {"type": msg_type, **kwargs}
    print(json.dumps(obj), flush=True)


def _build_chatml(messages):
    """Build ChatML format prompt."""
    parts = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        parts.append(f"<|im_start|>{role}\n{content}<|im_end|>\n")
    parts.append("<|im_start|>assistant\n")
    return "".join(parts)


def main():
    parser = argparse.ArgumentParser(description="AWQ Inference")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--messages", required=True)
    parser.add_argument("--max-tokens", type=int, default=512)
    args = parser.parse_args()

    if args.max_tokens > 4096:
        emit("error", text="max-tokens cannot exceed 4096")
        sys.exit(1)

    if not os.path.isdir(args.model_dir):
        emit("error", text=f"Model directory not found: {args.model_dir}")
        sys.exit(1)

    try:
        messages = json.loads(args.messages)
    except json.JSONDecodeError as e:
        emit("error", text=f"Invalid messages JSON: {e}")
        sys.exit(1)

    emit("status", text="Loading AWQ model...")

    try:
        import torch
    except ImportError as e:
        emit("error", text=f"PyTorch not installed: {e}")
        sys.exit(1)

    # CUDA check BEFORE importing AWQ
    if not torch.cuda.is_available():
        emit("error", text="AWQ inference requires CUDA GPU. No GPU detected.")
        sys.exit(1)

    try:
        from awq import AutoAWQForCausalLM
        from transformers import AutoTokenizer, TextIteratorStreamer
    except ImportError as e:
        emit("error", text=f"AWQ packages not installed: {e}")
        sys.exit(1)

    # Clear CUDA memory before loading
    import gc
    gc.collect()
    torch.cuda.empty_cache()

    # Detect available GPU memory
    gpu_mem_gb = torch.cuda.get_device_properties(0).total_mem / (1024**3)
    gpu_alloc = f"{int(gpu_mem_gb * 0.85)}GiB"  # Reserve 15% for overhead

    # Load model with memory management
    try:
        model = AutoAWQForCausalLM.from_quantized(
            args.model_dir,
            fuse_layers=False,
            safetensors=True,
            device_map="auto",
            max_memory={0: gpu_alloc, "cpu": "30GiB"},
        )
    except Exception as e:
        err_msg = str(e)
        # Fallback: try without safetensors=True (some models use .bin format)
        if "safetensors" in err_msg.lower() or "no such file" in err_msg.lower():
            emit("status", text="Retrying without safetensors...")
            try:
                model = AutoAWQForCausalLM.from_quantized(
                    args.model_dir,
                    fuse_layers=False,
                    safetensors=False,
                    device_map="auto",
                    max_memory={0: gpu_alloc, "cpu": "30GiB"},
                )
            except Exception as e2:
                emit("error", text=f"Failed to load AWQ model: {e2}")
                sys.exit(1)
        else:
            emit("error", text=f"Failed to load AWQ model: {err_msg}")
            sys.exit(1)

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.pad_token_id = tokenizer.eos_token_id

    # Build prompt with proper chat template
    if hasattr(tokenizer, 'apply_chat_template') and tokenizer.chat_template:
        try:
            input_text = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        except Exception:
            input_text = _build_chatml(messages)
    else:
        input_text = _build_chatml(messages)

    # Tokenize
    inputs = tokenizer(input_text, return_tensors="pt")
    device = next(model.model.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}

    # Setup streamer
    streamer = TextIteratorStreamer(
        tokenizer,
        skip_prompt=True,
        skip_special_tokens=True,
        timeout=120.0
    )

    generation_kwargs = {
        "input_ids": inputs["input_ids"],
        "attention_mask": inputs.get("attention_mask"),
        "max_new_tokens": args.max_tokens,
        "do_sample": True,
        "temperature": 0.7,
        "top_p": 0.9,
        "streamer": streamer,
        "pad_token_id": tokenizer.eos_token_id,
    }

    # Generate in thread
    thread = threading.Thread(target=model.generate, kwargs=generation_kwargs, daemon=True)
    thread.start()

    emit("status", text="Generating...")
    start_time = time.time()
    generated_text = ""
    chunk_count = 0

    try:
        for text in streamer:
            if text:
                emit("token", text=text)
                generated_text += text
                chunk_count += 1
    except Exception as e:
        emit("error", text=f"Generation error: {e}")
    finally:
        thread.join(timeout=30)

    # Count tokens once at the end instead of re-encoding each chunk
    token_count = len(tokenizer.encode(generated_text, add_special_tokens=False)) if generated_text else 0

    elapsed_ms = (time.time() - start_time) * 1000
    tokens_per_sec = (token_count / (elapsed_ms / 1000)) if elapsed_ms > 0 else 0

    emit("done", tokens_generated=token_count, time_ms=round(elapsed_ms), tokens_per_sec=round(tokens_per_sec, 2))

    # Cleanup model and GPU memory
    del model
    import gc
    gc.collect()
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
