#!/usr/bin/env python3
"""BitNet inference with proper dequantization.

Loads a BitNet-quantized model, applies scale factors for dequantization,
and streams generated tokens as JSON lines.

Output format:
  {"type":"token","text":"..."}
  {"type":"done","tokens_generated":N,"time_ms":M,"tokens_per_sec":X}
"""

import argparse
import gc
import json
import os
import sys
import time
import threading

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
BITNET_VENV = os.path.join(PROJECT_DIR, "venvs", "bitnet")
if os.path.isdir(BITNET_VENV):
    sys.path.insert(0, BITNET_VENV)
    site_pkg = os.path.join(BITNET_VENV, "lib", f"python{sys.version_info.major}.{sys.version_info.minor}", "site-packages")
    if os.path.isdir(site_pkg):
        sys.path.insert(0, site_pkg)


def emit(msg_type, **kwargs):
    print(json.dumps({"type": msg_type, **kwargs}), flush=True)


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
    parser = argparse.ArgumentParser(description="BitNet Inference")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--messages", required=True)
    parser.add_argument("--max-tokens", type=int, default=512)
    args = parser.parse_args()

    if not os.path.isdir(args.model_dir):
        emit("error", text=f"Model directory not found: {args.model_dir}")
        sys.exit(1)

    try:
        messages = json.loads(args.messages)
    except json.JSONDecodeError as e:
        emit("error", text=f"Invalid messages JSON: {e}")
        sys.exit(1)

    # Check for bitnet_meta.json
    meta_path = os.path.join(args.model_dir, "bitnet_meta.json")
    if not os.path.exists(meta_path):
        emit("error", text="Not a valid BitNet model - missing bitnet_meta.json")
        sys.exit(1)

    emit("status", text="Loading BitNet model...")

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
    except ImportError as e:
        emit("error", text=f"Required packages not installed: {e}")
        sys.exit(1)

    # Load metadata with scale factors
    with open(meta_path) as f:
        meta = json.load(f)
    scale_factors = meta.get("scale_factors", {})

    # Determine device
    device = "cuda" if torch.cuda.is_available() else "cpu"

    if device == "cuda":
        gc.collect()
        torch.cuda.empty_cache()

    # Load model
    try:
        compute_dtype = torch.float16 if device == "cuda" else torch.float32
        model = AutoModelForCausalLM.from_pretrained(
            args.model_dir,
            torch_dtype=compute_dtype,
            device_map="auto" if device == "cuda" else "cpu",
            trust_remote_code=True,
            low_cpu_mem_usage=True,
        )
    except Exception as e:
        emit("error", text=f"Failed to load model: {e}")
        sys.exit(1)

    # Note: weights are already stored as (scale * ternary) in safetensors,
    # so no additional dequantization is needed. The scale_factors in metadata
    # are kept for reference/analysis only.

    model.eval()

    # Load tokenizer
    tokenizer = AutoTokenizer.from_pretrained(args.model_dir, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.pad_token_id = tokenizer.eos_token_id

    emit("status", text=f"Loaded BitNet model ({meta.get('quantized_params', 0):,} ternary params) on {device}")

    # Build prompt
    if hasattr(tokenizer, 'apply_chat_template') and tokenizer.chat_template:
        try:
            input_text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        except Exception:
            input_text = _build_chatml(messages)
    else:
        input_text = _build_chatml(messages)

    # Tokenize
    inputs = tokenizer(input_text, return_tensors="pt").to(device)

    # Streamer
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True, timeout=120.0)

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

    thread = threading.Thread(target=model.generate, kwargs=generation_kwargs, daemon=True)
    thread.start()

    emit("status", text="Generating...")
    start_time = time.time()
    generated_text = ""

    try:
        for text in streamer:
            if text:
                emit("token", text=text)
                generated_text += text
    except Exception as e:
        emit("error", text=f"Generation error: {e}")
    finally:
        thread.join(timeout=30)

    token_count = len(tokenizer.encode(generated_text, add_special_tokens=False)) if generated_text else 0
    elapsed_ms = (time.time() - start_time) * 1000
    tokens_per_sec = (token_count / (elapsed_ms / 1000)) if elapsed_ms > 0 else 0

    emit("done", tokens_generated=token_count, time_ms=round(elapsed_ms), tokens_per_sec=round(tokens_per_sec, 2))

    # Cleanup GPU memory
    del model
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
