#!/usr/bin/env python3
"""VLM (Vision-Language Model) inference with streaming.

Loads a VLM model and processes text+image inputs.
Supports models with AutoProcessor (Qwen-VL, LLaVA, SmolVLM, etc).

Output format:
  {"type":"token","text":"..."}
  {"type":"done","tokens_generated":N,"time_ms":M,"tokens_per_sec":X}
"""
import argparse
import base64
import json
import os
import sys
import time
import threading
import tempfile

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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True)
    parser.add_argument("--messages", required=True)
    parser.add_argument("--image", default=None, help="Base64-encoded image (inline)")
    parser.add_argument("--image-file", default=None, help="Path to file containing base64-encoded image")
    parser.add_argument("--max-tokens", type=int, default=512)
    args = parser.parse_args()

    # Load image from file if --image-file provided (avoids CLI arg length limits)
    if args.image_file and not args.image:
        try:
            with open(args.image_file, "r") as f:
                args.image = f.read().strip()
        except Exception as e:
            emit("error", text=f"Failed to read image file: {e}")
            sys.exit(1)

    messages = json.loads(args.messages)
    emit("status", text="Loading VLM model...")

    try:
        import torch
        from transformers import AutoProcessor, AutoConfig, TextIteratorStreamer
        from PIL import Image
    except ImportError as e:
        emit("error", text=f"Missing dependency: {e}. Ensure transformers, torch, and Pillow are installed.")
        sys.exit(1)

    if not torch.cuda.is_available():
        emit("error", text="VLM inference requires a CUDA GPU.")
        sys.exit(1)

    # Clear CUDA memory
    import gc
    gc.collect()
    torch.cuda.empty_cache()

    # Detect model architecture to use the right class
    try:
        config = AutoConfig.from_pretrained(args.model_dir, trust_remote_code=True)
        arch = getattr(config, "architectures", [""])[0] if hasattr(config, "architectures") else ""
    except Exception:
        arch = ""

    emit("status", text=f"Detected architecture: {arch or 'auto'}")

    # Load model with architecture-specific class
    try:
        processor = AutoProcessor.from_pretrained(args.model_dir, trust_remote_code=True)
    except Exception:
        from transformers import AutoTokenizer
        processor = AutoTokenizer.from_pretrained(args.model_dir, trust_remote_code=True)

    try:
        if "Qwen2VL" in arch or "Qwen2_VL" in arch:
            from transformers import Qwen2VLForConditionalGeneration
            model = Qwen2VLForConditionalGeneration.from_pretrained(
                args.model_dir, torch_dtype=torch.float16, device_map="auto", trust_remote_code=True,
            )
        elif "Llava" in arch:
            from transformers import LlavaForConditionalGeneration
            model = LlavaForConditionalGeneration.from_pretrained(
                args.model_dir, torch_dtype=torch.float16, device_map="auto", trust_remote_code=True,
            )
        else:
            # Default: AutoModelForVision2Seq (SmolVLM, Idefics, PaliGemma, etc.)
            from transformers import AutoModelForVision2Seq
            model = AutoModelForVision2Seq.from_pretrained(
                args.model_dir, torch_dtype=torch.float16, device_map="auto", trust_remote_code=True,
            )
    except Exception as e:
        emit("error", text=f"Failed to load VLM model: {e}")
        sys.exit(1)

    # Decode image if provided
    image = None
    tmp_path = None
    if args.image:
        try:
            img_b64 = args.image
            # Strip data URI prefix if present (e.g., "data:image/jpeg;base64,...")
            if img_b64.startswith("data:"):
                img_b64 = img_b64.split(",", 1)[1] if "," in img_b64 else img_b64
            img_data = base64.b64decode(img_b64)
            tmp = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            tmp.write(img_data)
            tmp.close()
            tmp_path = tmp.name
            image = Image.open(tmp_path).convert("RGB")
        except Exception as e:
            emit("status", text=f"Warning: Failed to decode image: {e}")

    # Build conversation for the processor
    last_msg = messages[-1]["content"] if messages else "Describe this image."

    try:
        # Try using chat template with image
        if image is not None:
            mm_messages = []
            for msg in messages[:-1]:
                mm_messages.append({"role": msg["role"], "content": msg["content"]})
            # Add image + text for last message
            mm_messages.append({
                "role": "user",
                "content": [
                    {"type": "image"},
                    {"type": "text", "text": last_msg},
                ],
            })
            text = processor.apply_chat_template(mm_messages, add_generation_prompt=True)
            inputs = processor(text=text, images=[image], return_tensors="pt").to(model.device)
        else:
            text = processor.apply_chat_template(messages, add_generation_prompt=True)
            inputs = processor(text=text, return_tensors="pt").to(model.device)
    except Exception:
        # Fallback: simple prompt construction
        if image is not None:
            inputs = processor(text=last_msg, images=image, return_tensors="pt").to(model.device)
        else:
            inputs = processor(text=last_msg, return_tensors="pt").to(model.device)

    # Get the right tokenizer for streamer
    tokenizer_for_streamer = processor
    if not hasattr(processor, 'decode'):
        tokenizer_for_streamer = getattr(processor, 'tokenizer', processor)

    streamer = TextIteratorStreamer(
        tokenizer_for_streamer,
        skip_prompt=True,
        skip_special_tokens=True,
    )

    gen_kwargs = {
        **inputs,
        "max_new_tokens": args.max_tokens,
        "streamer": streamer,
        "do_sample": True,
        "temperature": 0.7,
        "top_p": 0.9,
    }

    t0 = time.time()
    thread = threading.Thread(target=model.generate, kwargs=gen_kwargs, daemon=True)
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

    # Count tokens once at the end using the correct tokenizer
    try:
        token_count = len(tokenizer_for_streamer.encode(generated_text, add_special_tokens=False)) if generated_text else 0
    except Exception:
        token_count = max(len(generated_text.split()), 1) if generated_text else 0

    elapsed = (time.time() - t0) * 1000
    tps = (token_count / (elapsed / 1000)) if elapsed > 0 else 0
    emit("done", tokens_generated=token_count, time_ms=round(elapsed), tokens_per_sec=round(tps, 1))

    # Cleanup
    if tmp_path:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass
    del model
    gc.collect()
    torch.cuda.empty_cache()


if __name__ == "__main__":
    main()
