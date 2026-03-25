#!/usr/bin/env python3
"""GPTQ inference script using AutoGPTQ + transformers TextIteratorStreamer.

Loads a GPTQ-quantized model and streams generated tokens as JSON lines.

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

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
GPTQ_VENV = os.path.join(PROJECT_DIR, "venvs", "gptq")
if os.path.isdir(GPTQ_VENV):
    sys.path.insert(0, GPTQ_VENV)
    site_pkg = os.path.join(GPTQ_VENV, "lib", f"python{sys.version_info.major}.{sys.version_info.minor}", "site-packages")
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
    parser = argparse.ArgumentParser(description="GPTQ Inference")
    parser.add_argument("--model-dir", required=True, help="Path to GPTQ model directory")
    parser.add_argument("--messages", required=True, help="JSON array of chat messages")
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

    emit("status", text="Loading GPTQ model...")
    try:
        import torch
        from transformers import AutoTokenizer, TextIteratorStreamer
        from auto_gptq import AutoGPTQForCausalLM
    except ImportError as e:
        emit("error", text=f"Required packages not installed: {e}")
        sys.exit(1)

    # Load model and tokenizer
    try:
        tokenizer = AutoTokenizer.from_pretrained(args.model_dir, trust_remote_code=True)
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
            tokenizer.pad_token_id = tokenizer.eos_token_id

        use_cuda = torch.cuda.is_available()
        device_str = "cuda:0" if use_cuda else "cpu"

        load_kwargs = {
            "device": device_str,
            "trust_remote_code": True,
            "use_safetensors": True,
        }
        if not use_cuda:
            load_kwargs["disable_exllama"] = True
            load_kwargs["disable_exllamav2"] = True

        model = AutoGPTQForCausalLM.from_quantized(args.model_dir, **load_kwargs)
        emit("status", text=f"Model loaded on {device_str}, generating...")
    except Exception as e:
        emit("error", text=f"Failed to load model: {e}")
        sys.exit(1)

    # Format prompt using chat template
    if hasattr(tokenizer, 'apply_chat_template') and tokenizer.chat_template:
        try:
            input_text = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        except Exception:
            input_text = _build_chatml(messages)
    else:
        input_text = _build_chatml(messages)

    # Safe device detection
    try:
        device = next(model.parameters()).device
    except (StopIteration, AttributeError):
        device = torch.device(device_str)

    inputs = tokenizer(input_text, return_tensors="pt")
    inputs = {k: v.to(device) for k, v in inputs.items()}

    # Set up streamer
    streamer = TextIteratorStreamer(
        tokenizer, skip_prompt=True, skip_special_tokens=True, timeout=120.0
    )

    generation_kwargs = {
        "input_ids": inputs["input_ids"],
        "attention_mask": inputs.get("attention_mask"),
        "max_new_tokens": args.max_tokens,
        "streamer": streamer,
        "do_sample": True,
        "temperature": 0.7,
        "top_p": 0.9,
        "pad_token_id": tokenizer.eos_token_id,
    }

    # Generate in background thread
    start_time = time.time()
    generated_text = ""

    thread = threading.Thread(target=model.generate, kwargs=generation_kwargs, daemon=True)
    thread.start()

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
    tok_per_sec = (token_count / (elapsed_ms / 1000)) if elapsed_ms > 0 else 0

    emit("done",
         tokens_generated=token_count,
         time_ms=round(elapsed_ms),
         tokens_per_sec=round(tok_per_sec, 2))


if __name__ == "__main__":
    main()
