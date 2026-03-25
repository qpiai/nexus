#!/usr/bin/env python3
"""FP16 (unquantized) inference with streaming.

Loads a full-precision HuggingFace model and streams tokens.
Uses device_map='auto' for GPU offloading when available.

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
# Use AWQ venv (has transformers + torch with CUDA)
AWQ_VENV = os.path.join(PROJECT_DIR, "venvs", "awq")
if os.path.isdir(AWQ_VENV):
    sys.path.insert(0, AWQ_VENV)
    site_pkg = os.path.join(AWQ_VENV, "lib", f"python{sys.version_info.major}.{sys.version_info.minor}", "site-packages")
    if os.path.isdir(site_pkg):
        sys.path.insert(0, site_pkg)


def emit(msg_type, **kwargs):
    print(json.dumps({"type": msg_type, **kwargs}), flush=True)


def _build_chatml(messages):
    parts = []
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        parts.append(f"<|im_start|>{role}\n{content}<|im_end|>\n")
    parts.append("<|im_start|>assistant\n")
    return "".join(parts)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--messages", required=True)
    parser.add_argument("--max-tokens", type=int, default=512)
    args = parser.parse_args()

    messages = json.loads(args.messages)
    emit("status", text="Loading FP16 model...")

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
    except ImportError as e:
        emit("error", text=f"Missing dependency: {e}. Ensure transformers and torch are installed.")
        sys.exit(1)

    # Clear GPU memory before loading
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    try:
        tokenizer = AutoTokenizer.from_pretrained(args.model_dir, trust_remote_code=True)
        model = AutoModelForCausalLM.from_pretrained(
            args.model_dir,
            torch_dtype=torch.float16,
            device_map="auto",
            trust_remote_code=True,
        )
    except Exception as e:
        emit("error", text=f"Failed to load model: {e}")
        sys.exit(1)

    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.pad_token_id = tokenizer.eos_token_id

    # Try apply_chat_template first, fall back to ChatML
    try:
        prompt = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    except Exception:
        prompt = _build_chatml(messages)

    input_ids = tokenizer(prompt, return_tensors="pt").input_ids.to(model.device)
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

    gen_kwargs = dict(
        input_ids=input_ids,
        max_new_tokens=args.max_tokens,
        streamer=streamer,
        do_sample=True,
        temperature=0.7,
        top_p=0.9,
    )

    t0 = time.time()
    thread = threading.Thread(target=model.generate, kwargs=gen_kwargs, daemon=True)
    thread.start()

    emit("status", text="Generating...")
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
    elapsed = (time.time() - t0) * 1000
    tps = (token_count / (elapsed / 1000)) if elapsed > 0 else 0
    emit("done", tokens_generated=token_count, time_ms=round(elapsed), tokens_per_sec=round(tps, 1))

    # Cleanup GPU memory
    del model
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
