#!/usr/bin/env python3
"""Inference script for finetuned LoRA models using transformers + peft."""

import argparse
import json
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
FT_VENV = os.path.join(PROJECT_DIR, "venvs", "finetune")

# Add finetune venv to path
for pyver in ["3.10", "3.11", "3.12"]:
    site_pkg = os.path.join(FT_VENV, "lib", f"python{pyver}", "site-packages")
    if os.path.isdir(site_pkg):
        sys.path.insert(0, site_pkg)
        break


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
    parser = argparse.ArgumentParser(description="Finetuned LoRA Inference")
    parser.add_argument("--adapter-dir", required=True,
                        help="Path to checkpoint dir with adapter_config.json")
    parser.add_argument("--messages", required=True, help="JSON messages array")
    parser.add_argument("--max-tokens", type=int, default=512)
    args = parser.parse_args()

    if not os.path.isdir(args.adapter_dir):
        emit("error", text=f"Adapter directory not found: {args.adapter_dir}")
        sys.exit(1)

    adapter_config_path = os.path.join(args.adapter_dir, "adapter_config.json")
    if not os.path.exists(adapter_config_path):
        emit("error", text=f"adapter_config.json not found in {args.adapter_dir}")
        sys.exit(1)

    try:
        messages = json.loads(args.messages)
    except json.JSONDecodeError as e:
        emit("error", text=f"Invalid messages JSON: {e}")
        sys.exit(1)

    # Read base model from adapter config
    with open(adapter_config_path) as f:
        adapter_config = json.load(f)
    base_model_name = adapter_config.get("base_model_name_or_path", "")
    if not base_model_name:
        emit("error", text="No base_model_name_or_path in adapter config")
        sys.exit(1)

    emit("status", text=f"Loading base model {base_model_name} + LoRA adapter...")

    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
        from peft import PeftModel
        from threading import Thread
    except ImportError as e:
        emit("error", text=f"Missing dependency: {e}. Ensure finetune venv is set up.")
        sys.exit(1)

    try:
        tokenizer = AutoTokenizer.from_pretrained(
            base_model_name,
            trust_remote_code=True,
            token=os.environ.get("HF_TOKEN"),
        )

        model = AutoModelForCausalLM.from_pretrained(
            base_model_name,
            torch_dtype=torch.float16,
            device_map="auto",
            trust_remote_code=True,
            token=os.environ.get("HF_TOKEN"),
        )

        model = PeftModel.from_pretrained(model, args.adapter_dir)
        model.eval()

    except Exception as e:
        emit("error", text=f"Failed to load model: {e}")
        sys.exit(1)

    # Build prompt using chat template
    if hasattr(tokenizer, "apply_chat_template") and tokenizer.chat_template:
        try:
            prompt = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
        except Exception:
            prompt = _build_chatml(messages)
    else:
        prompt = _build_chatml(messages)

    emit("status", text="Generating...")
    start_time = time.time()

    inputs = tokenizer(prompt, return_tensors="pt").to(model.device)
    input_len = inputs["input_ids"].shape[1]

    # Stream tokens
    streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)
    gen_kwargs = {
        **inputs,
        "max_new_tokens": args.max_tokens,
        "do_sample": True,
        "temperature": 0.7,
        "top_p": 0.9,
        "streamer": streamer,
    }

    thread = Thread(target=model.generate, kwargs=gen_kwargs)
    thread.start()

    generated_text = ""
    try:
        for text in streamer:
            if text:
                emit("token", text=text)
                generated_text += text
    except Exception as e:
        emit("error", text=f"Generation error: {e}")

    thread.join(timeout=30)

    token_count = len(tokenizer.encode(generated_text, add_special_tokens=False)) if generated_text else 0
    elapsed_ms = (time.time() - start_time) * 1000
    tokens_per_sec = (token_count / (elapsed_ms / 1000)) if elapsed_ms > 0 else 0

    emit("done",
         tokens_generated=token_count,
         time_ms=round(elapsed_ms),
         tokens_per_sec=round(tokens_per_sec, 2))

    # Cleanup GPU memory
    del model
    import gc
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
