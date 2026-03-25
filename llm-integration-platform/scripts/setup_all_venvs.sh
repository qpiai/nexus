#!/bin/bash
# Recreate all Python virtual environments using uv.
#
# Usage:
#   bash scripts/setup_all_venvs.sh          # Set up all venvs
#   bash scripts/setup_all_venvs.sh gguf     # Set up only GGUF venv
#   bash scripts/setup_all_venvs.sh finetune # Set up only finetune venv
#
# Prerequisites:
#   - uv (https://docs.astral.sh/uv/getting-started/installation/)
#     curl -LsSf https://astral.sh/uv/install.sh | sh
#
# Each venv is isolated with its own Python version and dependencies.
# GGUF needs transformers<5, while AWQ/GPTQ/finetune need transformers>=5.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENVS_DIR="$PROJECT_DIR/venvs"
REQS_DIR="$SCRIPT_DIR/requirements"

# Colors
info()  { echo -e "\033[1;34m[INFO]\033[0m $*"; }
ok()    { echo -e "\033[1;32m[ OK ]\033[0m $*"; }
warn()  { echo -e "\033[1;33m[WARN]\033[0m $*"; }
err()   { echo -e "\033[1;31m[ERR ]\033[0m $*"; }

# Check uv is installed
if ! command -v uv &> /dev/null; then
    err "uv is not installed. Install it with:"
    echo "  curl -LsSf https://astral.sh/uv/install.sh | sh"
    exit 1
fi

setup_venv() {
    local name="$1"
    local python_version="$2"
    local reqs_file="$REQS_DIR/${name}.txt"
    local venv_dir="$VENVS_DIR/$name"

    if [ ! -f "$reqs_file" ]; then
        err "Requirements file not found: $reqs_file"
        return 1
    fi

    info "Setting up $name venv (Python $python_version)..."

    # Remove existing venv if present
    if [ -d "$venv_dir" ]; then
        warn "Removing existing $name venv..."
        rm -rf "$venv_dir"
    fi

    # Create venv
    uv venv "$venv_dir" --python "$python_version"

    # Install packages
    uv pip install -r "$reqs_file" --python "$venv_dir/bin/python"

    ok "$name venv ready at $venv_dir"
    echo ""
}

setup_gguf()    { setup_venv "gguf"    "3.11"; }
setup_awq()     { setup_venv "awq"     "3.11"; }
setup_gptq()    { setup_venv "gptq"    "3.11"; }
setup_bitnet()  { setup_venv "bitnet"  "3.11"; }

setup_mlx() {
    if [[ "$(uname)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
        warn "Skipping MLX venv (Apple Silicon only)"
        return 0
    fi
    setup_venv "mlx" "3.11"
}

setup_finetune() { setup_venv "finetune" "3.10"; }
setup_vision()   { setup_venv "vision"   "3.10"; }

# Main
TARGET="${1:-all}"

case "$TARGET" in
    gguf)     setup_gguf ;;
    awq)      setup_awq ;;
    gptq)     setup_gptq ;;
    bitnet)   setup_bitnet ;;
    mlx)      setup_mlx ;;
    finetune) setup_finetune ;;
    vision)   setup_vision ;;
    all)
        info "Setting up all venvs with uv..."
        echo ""
        setup_gguf
        setup_awq
        setup_gptq
        setup_bitnet
        setup_mlx
        setup_finetune
        setup_vision
        echo ""
        ok "All venvs ready!"
        ;;
    *)
        err "Unknown venv: $TARGET"
        echo "Usage: $0 [gguf|awq|gptq|bitnet|mlx|finetune|vision|all]"
        exit 1
        ;;
esac

echo ""
info "Venv summary:"
for d in "$VENVS_DIR"/*/; do
    if [ -d "$d" ]; then
        size=$(du -sh "$d" 2>/dev/null | cut -f1)
        pyver=$("$d/bin/python" --version 2>/dev/null || echo "N/A")
        echo "  $(basename "$d"): $size ($pyver)"
    fi
done
