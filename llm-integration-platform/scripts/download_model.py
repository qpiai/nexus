#!/usr/bin/env python3
"""Download a HuggingFace model without quantization (FP16).

Output format (JSON lines):
  {"type":"progress","message":"...","progress":0.5}
  {"type":"complete","message":"...","output_path":"..."}
"""
import argparse
import json
import os
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
GGUF_VENV = os.path.join(PROJECT_DIR, "venvs", "gguf")
if os.path.isdir(GGUF_VENV):
    sys.path.insert(0, GGUF_VENV)


def emit(msg_type, message, progress=None, **kw):
    obj = {"type": msg_type, "message": message, **kw}
    if progress is not None:
        obj["progress"] = round(progress, 3)
    print(json.dumps(obj), flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--bits", type=int, default=16)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    model_name = args.model.split("/")[-1]
    output_path = os.path.join(args.output_dir, f"{model_name}-fp16")

    # Check if model already downloaded
    if os.path.isdir(output_path):
        # Look for model files (safetensors, bin, or config.json)
        has_model = any(
            f.endswith(('.safetensors', '.bin', '.gguf'))
            for f in os.listdir(output_path)
        )
        has_config = os.path.exists(os.path.join(output_path, 'config.json'))
        if has_model and has_config:
            total_size = sum(
                os.path.getsize(os.path.join(output_path, f))
                for f in os.listdir(output_path)
                if os.path.isfile(os.path.join(output_path, f))
            )
            size_mb = total_size / (1024 * 1024)
            emit("progress", f"Model already downloaded ({size_mb:.0f} MB). Skipping.", 0.95)
            emit("complete", f"Model already available as FP16 ({size_mb:.0f} MB)",
                 output_path=output_path, output_file=os.path.basename(output_path))
            return

    emit("progress", f"Downloading {args.model} from HuggingFace (no quantization)...", 0.05)

    try:
        from huggingface_hub import snapshot_download
    except ImportError:
        emit("error", "huggingface_hub not installed. Install with: pip install huggingface_hub")
        sys.exit(1)

    try:
        token = os.environ.get("HF_TOKEN") or None
        emit("progress", "Starting download...", 0.1)
        snapshot_download(repo_id=args.model, local_dir=output_path, token=token)
        emit("progress", "Model downloaded successfully", 0.95)
        emit("complete", f"Model saved as FP16 (unquantized)", output_path=output_path,
             output_file=os.path.basename(output_path))
    except Exception as e:
        emit("error", f"Download failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
