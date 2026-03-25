#!/usr/bin/env python3
"""MLX inference script with streaming for Apple Silicon."""

import argparse
import json
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
MLX_VENV = os.path.join(PROJECT_DIR, "venvs", "mlx")

if os.path.isdir(MLX_VENV):
    sys.path.insert(0, MLX_VENV)
    site_pkg = os.path.join(
        MLX_VENV, "lib",
        f"python{sys.version_info.major}.{sys.version_info.minor}",
        "site-packages",
    )
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
    parser = argparse.ArgumentParser(description="MLX Inference")
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--messages", required=True)
    parser.add_argument("--max-tokens", type=int, default=512)
    args = parser.parse_args()

    # Check platform FIRST before any MLX imports
    import platform
    if platform.system() != "Darwin" or platform.machine() not in ("arm64", "aarch64"):
        emit("error", text="MLX inference requires Apple Silicon. "
             f"This server is running {platform.system()} {platform.machine()}.")
        sys.exit(1)

    if not os.path.isdir(args.model_dir):
        emit("error", text=f"Model directory not found: {args.model_dir}")
        sys.exit(1)

    try:
        messages = json.loads(args.messages)
    except json.JSONDecodeError as e:
        emit("error", text=f"Invalid messages JSON: {e}")
        sys.exit(1)

    emit("status", text="Loading MLX model...")

    try:
        from mlx_lm import load, stream_generate
    except ImportError:
        emit("error", text="mlx-lm not installed. Run: pip install mlx-lm")
        sys.exit(1)

    try:
        model, tokenizer = load(args.model_dir)
    except Exception as e:
        emit("error", text=f"Failed to load MLX model: {e}")
        sys.exit(1)

    # Build prompt using tokenizer chat template if available
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
    generated_text = ""
    token_count = 0

    try:
        for response in stream_generate(
            model,
            tokenizer,
            prompt=prompt,
            max_tokens=args.max_tokens,
        ):
            text = response.text
            if text:
                emit("token", text=text)
                generated_text += text
                token_count += 1
    except Exception as e:
        emit("error", text=f"Generation error: {e}")

    elapsed_ms = (time.time() - start_time) * 1000
    tokens_per_sec = (token_count / (elapsed_ms / 1000)) if elapsed_ms > 0 else 0

    emit("done",
         tokens_generated=token_count,
         time_ms=round(elapsed_ms),
         tokens_per_sec=round(tokens_per_sec, 2))


if __name__ == "__main__":
    main()
