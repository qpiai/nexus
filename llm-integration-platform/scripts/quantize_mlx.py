#!/usr/bin/env python3
"""MLX quantization script for Apple Silicon."""

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


def main():
    parser = argparse.ArgumentParser(description="MLX Quantization")
    parser.add_argument("--model", "--model-id", required=True, dest="model_id",
                        help="HuggingFace model repo ID")
    parser.add_argument("--bits", type=int, default=4, choices=[4, 8])
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--hf-token", default=None)
    args = parser.parse_args()

    # Check platform FIRST before any MLX imports
    import platform
    if platform.system() != "Darwin" or platform.machine() not in ("arm64", "aarch64"):
        emit("error", message="MLX quantization requires Apple Silicon (M1/M2/M3/M4/M5). "
             f"This server is running {platform.system()} {platform.machine()}. "
             "Use GGUF, AWQ, or GPTQ instead.")
        sys.exit(1)

    emit("progress", message="Starting MLX quantization...", progress=0.0)

    try:
        import mlx_lm
    except ImportError:
        emit("error", message="mlx-lm not installed. Run: pip install mlx-lm")
        sys.exit(1)

    emit("progress", message=f"Downloading and converting {args.model_id}...", progress=0.1)

    os.makedirs(args.output_dir, exist_ok=True)
    start_time = time.time()

    # Build output directory name: {model_name}-mlx-{bits}bit
    model_short = args.model_id.split("/")[-1]
    out_dir_name = f"{model_short}-mlx-{args.bits}bit"
    mlx_output = os.path.join(args.output_dir, out_dir_name)

    try:
        from mlx_lm import convert

        # mlx_lm.convert handles download + quantization in one step
        # It downloads from HuggingFace, converts weights to MLX format,
        # and optionally quantizes to the specified bit depth
        convert(
            args.model_id,
            mlx_path=mlx_output,
            quantize=(args.bits < 16),
            q_bits=args.bits,
            q_group_size=64,
        )

        elapsed = time.time() - start_time

        # Calculate output size
        total_size = 0
        for root, _dirs, files in os.walk(mlx_output):
            for f in files:
                total_size += os.path.getsize(os.path.join(root, f))
        size_gb = total_size / (1024 ** 3)

        emit("progress", message="MLX quantization complete!", progress=1.0)
        emit("complete",
             output_dir=mlx_output,
             file=out_dir_name,
             size_gb=round(size_gb, 2),
             elapsed_sec=round(elapsed, 1),
             method="mlx",
             bits=args.bits,
             message=f"MLX {args.bits}-bit quantization complete. Size: {size_gb:.2f} GB")

    except Exception as e:
        emit("error", message=f"MLX quantization failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
