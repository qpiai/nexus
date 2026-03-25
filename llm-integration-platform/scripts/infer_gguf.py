#!/usr/bin/env python3
"""GGUF inference script using llama-completion.

Finds or builds llama-completion from llama.cpp, then streams tokens
from a quantized GGUF model as JSON lines.

Output format:
  {"type":"token","text":"..."}
  {"type":"done","tokens_generated":N,"time_ms":M,"tokens_per_sec":X}
"""

import argparse
import json
import os
import sys
import subprocess
import time
import re

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)


def emit(msg_type, **kwargs):
    obj = {"type": msg_type, **kwargs}
    print(json.dumps(obj), flush=True)


def run_cmd(cmd, timeout=600, desc="command", cwd=None):
    env = os.environ.copy()
    local_bin = os.path.join(os.path.expanduser("~"), ".local", "bin")
    if local_bin not in env.get("PATH", ""):
        env["PATH"] = local_bin + ":" + env.get("PATH", "")
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout, env=env, cwd=cwd
        )
        return result.returncode == 0, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return False, "", f"{desc} timed out after {timeout}s"
    except Exception as e:
        return False, "", str(e)


def find_or_build_llama_completion():
    """Find or build llama-completion binary."""
    work_dir = os.path.join(PROJECT_DIR, "output", "_work_gguf")
    llama_cpp_dir = os.path.join(work_dir, "llama.cpp")
    build_dir = os.path.join(llama_cpp_dir, "build")
    bin_dir = os.path.join(build_dir, "bin")

    candidates = [
        os.path.join(bin_dir, "llama-completion"),
        os.path.join(build_dir, "llama-completion"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c

    # Need to build
    if not os.path.exists(os.path.join(llama_cpp_dir, "CMakeLists.txt")):
        emit("status", text="Cloning llama.cpp...")
        import shutil
        if os.path.exists(llama_cpp_dir):
            shutil.rmtree(llama_cpp_dir)
        ok, _, err = run_cmd(
            ["git", "clone", "--depth=1", "https://github.com/ggerganov/llama.cpp", llama_cpp_dir],
            timeout=120, desc="git clone"
        )
        if not ok:
            emit("error", text=f"Failed to clone llama.cpp: {err}")
            sys.exit(1)

    emit("status", text="Building llama-completion (one-time)...")
    os.makedirs(build_dir, exist_ok=True)

    import shutil as _shutil
    for cmake_args in [
        ["cmake", "..", "-DGGML_CUDA=ON", "-DCMAKE_BUILD_TYPE=Release"],
        ["cmake", "..", "-DGGML_CUDA=OFF", "-DCMAKE_BUILD_TYPE=Release"],
    ]:
        # Clear stale cmake cache before each attempt
        cache_file = os.path.join(build_dir, "CMakeCache.txt")
        if os.path.exists(cache_file):
            os.remove(cache_file)
        cmake_files_dir = os.path.join(build_dir, "CMakeFiles")
        if os.path.isdir(cmake_files_dir):
            _shutil.rmtree(cmake_files_dir, ignore_errors=True)

        ok, _, _ = run_cmd(cmake_args, timeout=120, cwd=build_dir)
        if ok:
            break

    ncpu = os.cpu_count() or 4
    run_cmd(["cmake", "--build", ".", "--target", "llama-completion", "-j", str(ncpu)],
            timeout=600, cwd=build_dir)

    for c in candidates:
        if os.path.exists(c):
            return c

    # Fallback: build all
    run_cmd(["cmake", "--build", ".", "-j", str(ncpu)], timeout=600, cwd=build_dir)

    for c in candidates:
        if os.path.exists(c):
            return c

    emit("error", text="llama-completion binary not found after build")
    sys.exit(1)


def clean_text(text):
    """Remove control characters, ANSI escapes, thinking tags, and EOF artifacts.

    IMPORTANT: Does NOT strip whitespace — callers rely on preserved spaces/newlines
    for correct token concatenation.
    """
    text = re.sub(r'\x1b\[[0-9;]*[a-zA-Z]', '', text)
    text = re.sub(r'.\x08', '', text)
    text = re.sub(r'[\x00-\x09\x0b-\x1f\x7f]', '', text)
    # Remove the "> EOF by user" artifact from stdin closure (anywhere in text)
    text = re.sub(r'>?\s*EOF by user\s*', '', text)
    # Remove bare "> " prefix artifacts from llama-completion
    text = re.sub(r'^\n?> $', '', text)
    # Strip <think>...</think> blocks from reasoning models (Qwen3, etc.)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    return text


def main():
    parser = argparse.ArgumentParser(description="GGUF Inference")
    parser.add_argument("--model", required=True, help="Path to .gguf model file")
    parser.add_argument("--prompt", required=True, help="ChatML formatted prompt")
    parser.add_argument("--max-tokens", type=int, default=512)
    args = parser.parse_args()

    if not os.path.exists(args.model):
        emit("error", text=f"Model file not found: {args.model}")
        sys.exit(1)

    emit("status", text="Loading model...")
    llama_bin = find_or_build_llama_completion()

    # Set LD_LIBRARY_PATH for shared libs
    build_bin_dir = os.path.dirname(llama_bin)
    env = os.environ.copy()
    ld_paths = [build_bin_dir]
    if env.get("LD_LIBRARY_PATH"):
        ld_paths.append(env["LD_LIBRARY_PATH"])
    env["LD_LIBRARY_PATH"] = ":".join(ld_paths)
    local_bin = os.path.join(os.path.expanduser("~"), ".local", "bin")
    env["PATH"] = local_bin + ":" + env.get("PATH", "")

    cmd = [
        llama_bin,
        "-m", args.model,
        "-p", args.prompt,
        "-n", str(args.max_tokens),
        "--no-display-prompt",
        "--simple-io",
        "--no-warmup",
    ]

    emit("status", text="Generating response...")
    start_time = time.time()

    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL,
            env=env,
        )

        generated_text = ""
        buffer = ""

        # Read stdout in real time — llama-completion with --simple-io writes progressively
        while True:
            chunk = proc.stdout.read(1)
            if not chunk:
                break
            char = chunk.decode("utf-8", errors="replace")
            buffer += char
            # Emit at natural boundaries or when buffer is large enough
            if char in (" ", "\n") or len(buffer) >= 8:
                cleaned = clean_text(buffer)
                if cleaned:
                    emit("token", text=cleaned)
                    generated_text += cleaned
                elif buffer and not buffer.strip():
                    # Buffer was pure whitespace (e.g. a space) — preserve it
                    emit("token", text=buffer)
                    generated_text += buffer
                buffer = ""

        # Flush remaining buffer
        if buffer:
            cleaned = clean_text(buffer)
            if cleaned:
                emit("token", text=cleaned)
                generated_text += cleaned

        # Wait for process to finish and capture stderr
        proc.wait(timeout=120)
        elapsed_ms = (time.time() - start_time) * 1000

        # Get accurate token count from llama.cpp stderr stats
        stderr_text = proc.stderr.read().decode("utf-8", errors="replace")
        eval_match = re.search(r"eval\s+time\s*=\s*[\d.]+\s*ms\s*/\s*(\d+)\s*(?:tokens|runs)", stderr_text)
        if eval_match:
            token_count = int(eval_match.group(1))
        else:
            # Fallback: approximate with word count
            token_count = max(len(generated_text.split()), 1) if generated_text else 0

        if not generated_text.strip():
            emit("error", text="No output generated from model")
            sys.exit(1)

        tok_per_sec = token_count / (elapsed_ms / 1000) if elapsed_ms > 0 else 0

        emit("done",
             tokens_generated=token_count,
             time_ms=round(elapsed_ms),
             tokens_per_sec=round(tok_per_sec, 1))

    except subprocess.TimeoutExpired:
        try:
            proc.kill()
        except Exception:
            pass
        emit("error", text="Generation timed out after 120s")
        sys.exit(1)
    except Exception as e:
        emit("error", text=str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
