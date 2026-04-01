#!/usr/bin/env python3
"""GGUF quantization script.

Downloads a model from HuggingFace, converts to GGUF using llama.cpp's
convert_hf_to_gguf.py, then quantizes with llama-quantize.

Uses PYTHONPATH from env to find packages in isolated venv dir.
"""

import argparse
import json
import os
import sys
import subprocess
import shutil

# Ensure our venv packages take priority over system packages
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
GGUF_VENV = os.path.join(PROJECT_DIR, "venvs", "gguf")
if os.path.isdir(GGUF_VENV):
    sys.path.insert(0, GGUF_VENV)
    os.environ["PYTHONPATH"] = GGUF_VENV + ":" + os.environ.get("PYTHONPATH", "")

def emit(msg_type, message, progress=None):
    """Emit a JSON progress line to stdout."""
    obj = {"type": msg_type, "message": message}
    if progress is not None:
        obj["progress"] = round(progress, 3)
    print(json.dumps(obj), flush=True)

QUANT_MAP = {
    2: "q2_K",
    3: "q3_K_M",
    4: "q4_K_M",
    5: "q5_K_M",
    8: "q8_0",
    16: "f16",  # No quantization — keep full FP16 precision
}

def run_cmd(cmd, timeout=600, desc="command", cwd=None):
    """Run a command and return stdout/stderr.

    Uses bytes mode (no text=True) to avoid UTF-8 decode errors
    from binary tool output (e.g., llama-quantize progress).
    """
    emit("progress", f"Running: {desc}")
    env = os.environ.copy()
    env["PYTHONPATH"] = GGUF_VENV + ":" + env.get("PYTHONPATH", "")
    # Ensure ~/.local/bin is in PATH (for pip-installed cmake, etc.)
    local_bin = os.path.join(os.path.expanduser("~"), ".local", "bin")
    if local_bin not in env.get("PATH", ""):
        env["PATH"] = local_bin + ":" + env.get("PATH", "")
    try:
        result = subprocess.run(
            cmd, capture_output=True, timeout=timeout, env=env, cwd=cwd
        )
        stdout = result.stdout.decode("utf-8", errors="replace") if result.stdout else ""
        stderr = result.stderr.decode("utf-8", errors="replace") if result.stderr else ""
        if result.returncode != 0:
            emit("log", f"stdout: {stdout[-1000:]}")
            emit("log", f"stderr: {stderr[-1000:]}")
            return False, stderr[-1000:]
        return True, stdout
    except subprocess.TimeoutExpired:
        return False, f"{desc} timed out after {timeout}s"
    except Exception as e:
        return False, str(e)

def main():
    parser = argparse.ArgumentParser(description="GGUF Quantization")
    parser.add_argument("--model", required=True, help="HuggingFace repo ID")
    parser.add_argument("--bits", type=int, required=True, choices=[2, 3, 4, 5, 8, 16])
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    quant_type = QUANT_MAP[args.bits]
    model_name = args.model.split("/")[-1]
    work_dir = os.path.join(args.output_dir, "_work_gguf")
    os.makedirs(work_dir, exist_ok=True)

    # Step 1: Download model (or use local path for finetuned models)
    is_local = os.path.isdir(args.model)
    if is_local:
        local_dir = args.model
        model_name = os.path.basename(os.path.normpath(args.model)) or "finetuned"
        emit("progress", f"Using local model: {local_dir}", 0.05)
        # Verify it looks like a HF model directory
        has_model_files = any(
            f.endswith(('.safetensors', '.bin', '.pt'))
            for f in os.listdir(local_dir) if os.path.isfile(os.path.join(local_dir, f))
        )
        if not has_model_files:
            emit("error", f"Local path does not contain model files (.safetensors/.bin): {local_dir}")
            sys.exit(1)
        emit("progress", f"Local model verified: {model_name}", 0.25)
    else:
        emit("progress", f"Downloading {args.model} from HuggingFace...", 0.05)
        try:
            from huggingface_hub import snapshot_download
            hf_model_dir = os.path.join(work_dir, "hf_model")
            # Clean previous model download to avoid stale files
            if os.path.exists(hf_model_dir):
                shutil.rmtree(hf_model_dir)
            token = os.environ.get("HF_TOKEN") or None
            local_dir = snapshot_download(
                repo_id=args.model,
                local_dir=hf_model_dir,
                token=token,
            )
            emit("progress", f"Model downloaded to {local_dir}", 0.25)
        except Exception as e:
            emit("error", f"Failed to download model: {e}")
            sys.exit(1)

    # Step 1b: Check for pre-quantized GGUF repos (skip for local/finetuned models)
    PRE_QUANTIZED_REPOS = {
        "LiquidAI/LFM2-1.2B-Instruct": "LiquidAI/LFM2-1.2B-Instruct-GGUF",
        "LiquidAI/LFM2.5-1.2B-Instruct": "LiquidAI/LFM2.5-1.2B-Instruct-GGUF",
        "LiquidAI/LFM2-0.5B-Instruct": "LiquidAI/LFM2-0.5B-Instruct-GGUF",
        "LiquidAI/LFM2.5-0.5B-Instruct": "LiquidAI/LFM2.5-0.5B-Instruct-GGUF",
    }
    gguf_repo = None if is_local else PRE_QUANTIZED_REPOS.get(args.model)
    if gguf_repo:
        # Try downloading pre-quantized GGUF directly (much faster)
        emit("progress", f"Pre-quantized GGUF available: {gguf_repo}. Trying direct download...", 0.30)
        try:
            from huggingface_hub import hf_hub_download, list_repo_files
            token = os.environ.get("HF_TOKEN") or None
            repo_files = list_repo_files(gguf_repo, token=token)
            # Find matching GGUF file for requested quantization
            candidates = [f for f in repo_files if f.endswith(".gguf")]
            # Try exact quant_type match first
            match = None
            for f in candidates:
                fname_lower = f.lower()
                if quant_type.lower().replace("_", "-") in fname_lower.replace("_", "-"):
                    match = f
                    break
            if not match and args.bits == 16:
                for f in candidates:
                    if "f16" in f.lower() or "fp16" in f.lower():
                        match = f
                        break
            if match:
                emit("progress", f"Downloading pre-quantized: {match}", 0.35)
                local_gguf = hf_hub_download(
                    repo_id=gguf_repo, filename=match,
                    local_dir=args.output_dir, token=token
                )
                # Move to standard output name
                output_path = os.path.join(args.output_dir, f"{model_name}-{quant_type}.gguf")
                actual_path = os.path.join(args.output_dir, match)
                if os.path.exists(actual_path) and actual_path != output_path:
                    shutil.move(actual_path, output_path)
                elif os.path.exists(local_gguf) and local_gguf != output_path:
                    shutil.copy2(local_gguf, output_path)
                size_mb = os.path.getsize(output_path) / (1024 * 1024)
                obj = {
                    "type": "complete",
                    "message": f"Pre-quantized {quant_type}: {os.path.basename(output_path)} ({size_mb:.1f} MB)",
                    "progress": 1.0,
                    "file": os.path.basename(output_path),
                }
                print(json.dumps(obj), flush=True)
                return
            else:
                emit("log", f"No {quant_type} file found in {gguf_repo}, falling back to local quantization")
        except Exception as e:
            emit("log", f"Pre-quantized download failed ({e}), falling back to local quantization")

    # Step 2: Clone llama.cpp (just for convert script + quantize binary)
    llama_cpp_dir = os.path.join(work_dir, "llama.cpp")
    if not os.path.exists(os.path.join(llama_cpp_dir, "convert_hf_to_gguf.py")):
        emit("progress", "Cloning llama.cpp conversion tools...", 0.30)
        if os.path.exists(llama_cpp_dir):
            shutil.rmtree(llama_cpp_dir)
        ok, err = run_cmd(
            ["git", "clone", "--depth=1", "https://github.com/ggerganov/llama.cpp", llama_cpp_dir],
            timeout=120, desc="git clone llama.cpp"
        )
        if not ok:
            emit("error", f"Failed to clone llama.cpp: {err}")
            sys.exit(1)
    else:
        emit("progress", "Updating llama.cpp...", 0.30)
        # Ensure remote points to GitHub (may have been changed)
        run_cmd(
            ["git", "remote", "set-url", "origin", "https://github.com/ggerganov/llama.cpp"],
            timeout=10, desc="fix llama.cpp remote", cwd=llama_cpp_dir
        )
        pull_ok, _ = run_cmd(
            ["git", "pull", "--ff-only"],
            timeout=60, desc="git pull llama.cpp", cwd=llama_cpp_dir
        )
        if pull_ok:
            # Force rebuild after update — remove old build dir
            old_build = os.path.join(llama_cpp_dir, "build")
            if os.path.isdir(old_build):
                shutil.rmtree(old_build, ignore_errors=True)
        else:
            emit("log", "git pull failed, continuing with existing llama.cpp source")

    # Install llama.cpp Python requirements for convert script
    emit("progress", "Installing conversion dependencies...", 0.32)
    req_file = os.path.join(llama_cpp_dir, "requirements", "requirements-convert_hf_to_gguf.txt")
    if os.path.exists(req_file):
        # Use uv pip if available (faster), fallback to pip3
        uv_bin = os.path.expanduser("~/.local/bin/uv")
        uv_pip = os.path.expanduser("~/.local/share/uv/python/cpython-3.10.20-linux-x86_64-gnu/bin/pip3")
        if os.path.exists(uv_bin):
            # --index-strategy unsafe-best-match avoids protobuf 6.x conflict
            run_cmd(
                [uv_bin, "pip", "install", "--target", GGUF_VENV, "--python", sys.executable,
                 "--index-strategy", "unsafe-best-match", "-q", "-r", req_file],
                timeout=120, desc="install convert requirements (uv)"
            )
        elif os.path.exists(uv_pip):
            run_cmd(
                [uv_pip, "install", "--target", GGUF_VENV, "--break-system-packages", "-q", "-r", req_file],
                timeout=120, desc="install convert requirements (pip3)"
            )
        else:
            # Last resort: system pip3
            run_cmd(
                ["pip3", "install", "--target", GGUF_VENV, "--break-system-packages", "-q", "-r", req_file],
                timeout=120, desc="install convert requirements (system pip3)"
            )

    # Step 3: Convert HF to GGUF F16
    emit("progress", "Converting model to GGUF format (F16)...", 0.35)
    convert_script = os.path.join(llama_cpp_dir, "convert_hf_to_gguf.py")
    gguf_f16_path = os.path.join(work_dir, f"{model_name}-f16.gguf")

    ok, err = run_cmd(
        ["python3", convert_script, local_dir, "--outfile", gguf_f16_path, "--outtype", "f16"],
        timeout=600, desc="GGUF F16 conversion"
    )
    if not ok:
        emit("error", f"GGUF conversion failed: {err}")
        sys.exit(1)
    if not os.path.exists(gguf_f16_path):
        emit("error", "GGUF F16 file not created")
        sys.exit(1)
    f16_size = os.path.getsize(gguf_f16_path) / (1024*1024)
    emit("progress", f"F16 GGUF created: {f16_size:.0f} MB", 0.55)

    # For 16-bit (FP16 / no quantization): skip quantize, just move the F16 file
    if args.bits == 16:
        output_path = os.path.join(args.output_dir, f"{model_name}-f16.gguf")
        import shutil as _shutil
        _shutil.move(gguf_f16_path, output_path)
        size_mb = os.path.getsize(output_path) / (1024 * 1024)
        emit("progress", f"FP16 model ready (no quantization): {os.path.basename(output_path)} ({size_mb:.1f} MB)", 0.95)
        obj = {
            "type": "complete",
            "message": f"FP16 GGUF (no quantization): {os.path.basename(output_path)} ({size_mb:.1f} MB)",
            "progress": 1.0,
            "file": os.path.basename(output_path),
        }
        print(json.dumps(obj), flush=True)
        return

    # Step 4: Build llama-quantize
    emit("progress", "Building llama.cpp quantize tool...", 0.58)
    build_dir = os.path.join(llama_cpp_dir, "build")
    quantize_bin = os.path.join(build_dir, "bin", "llama-quantize")

    if not os.path.exists(quantize_bin):
        os.makedirs(build_dir, exist_ok=True)

        # Try CPU-only first (most environments lack nvcc), fall back to CUDA
        cmake_ok = False
        for cmake_args in [
            ["cmake", "..", "-DGGML_CUDA=OFF", "-DCMAKE_BUILD_TYPE=Release"],
            ["cmake", "..", "-DGGML_CUDA=ON", "-DCMAKE_BUILD_TYPE=Release"],
        ]:
            # Clear stale cmake cache before each attempt
            cache_file = os.path.join(build_dir, "CMakeCache.txt")
            if os.path.exists(cache_file):
                os.remove(cache_file)
            cmake_files_dir = os.path.join(build_dir, "CMakeFiles")
            if os.path.isdir(cmake_files_dir):
                shutil.rmtree(cmake_files_dir, ignore_errors=True)

            ok, err = run_cmd(cmake_args, timeout=120, desc="cmake configure", cwd=build_dir)
            if ok:
                cmake_ok = True
                break
            emit("log", f"cmake config failed ({cmake_args}), trying fallback...")

        if not cmake_ok:
            emit("error", f"cmake failed: {err}")
            sys.exit(1)

        ncpu = os.cpu_count() or 4
        ok, err = run_cmd(
            ["cmake", "--build", ".", "--target", "llama-quantize", "-j", str(ncpu)],
            timeout=600, desc="building llama-quantize", cwd=build_dir
        )
        # If target-specific build fails, try building everything
        if not ok:
            emit("progress", "Target build failed, building all...", 0.62)
            ok, err = run_cmd(
                ["cmake", "--build", ".", "-j", str(ncpu)],
                timeout=600, desc="building llama.cpp", cwd=build_dir
            )

        if not os.path.exists(quantize_bin):
            # Check alternative locations
            for alt in [
                os.path.join(build_dir, "llama-quantize"),
                os.path.join(llama_cpp_dir, "build", "bin", "Release", "llama-quantize"),
            ]:
                if os.path.exists(alt):
                    quantize_bin = alt
                    break
            else:
                emit("error", f"llama-quantize binary not found after build. Error: {err}")
                sys.exit(1)

    emit("progress", "Quantize tool ready", 0.68)

    # Step 5: Quantize
    output_path = os.path.join(args.output_dir, f"{model_name}-{quant_type}.gguf")
    emit("progress", f"Quantizing to {quant_type} ({args.bits}-bit)...", 0.70)

    ok, err = run_cmd(
        [quantize_bin, gguf_f16_path, output_path, quant_type],
        timeout=600, desc=f"quantize to {quant_type}"
    )
    if not ok:
        emit("error", f"Quantization failed: {err}")
        sys.exit(1)

    if not os.path.exists(output_path):
        emit("error", "Quantized file not found")
        sys.exit(1)

    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    emit("progress", f"Output: {os.path.basename(output_path)} ({size_mb:.1f} MB)", 0.95)

    # Cleanup intermediate F16
    try:
        os.remove(gguf_f16_path)
    except:
        pass

    obj = {
        "type": "complete",
        "message": f"Successfully quantized to {quant_type}: {os.path.basename(output_path)} ({size_mb:.1f} MB)",
        "progress": 1.0,
        "file": os.path.basename(output_path),
    }
    print(json.dumps(obj), flush=True)

if __name__ == "__main__":
    main()
