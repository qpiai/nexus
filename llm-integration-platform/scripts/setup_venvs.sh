#!/bin/bash
# Setup virtual environments for Nexus quantization and inference scripts.
#
# Since python3-venv is not available and we don't have sudo,
# we use `pip install --target=<dir>` to create isolated package directories.
#
# IMPORTANT: GGUF and AWQ/GPTQ need DIFFERENT versions of transformers/huggingface-hub.
#
# Usage: bash scripts/setup_venvs.sh [venv_name]
#   If venv_name is provided, only that venv is set up.
#   If omitted, all venvs are set up.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VENVS_DIR="$PROJECT_DIR/venvs"
PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PIP_FLAGS="--break-system-packages --no-warn-script-location"

mkdir -p "$VENVS_DIR"

info() { echo -e "\033[1;34m[INFO]\033[0m $*"; }
warn() { echo -e "\033[1;33m[WARN]\033[0m $*"; }
ok()   { echo -e "\033[1;32m[ OK ]\033[0m $*"; }
err()  { echo -e "\033[1;31m[ERR ]\033[0m $*"; }

setup_gguf() {
    local VENV="$VENVS_DIR/gguf"
    local SITE_PKG="$VENV/lib/python$PY_VER/site-packages"
    info "Setting up GGUF venv at $VENV"

    mkdir -p "$SITE_PKG"
    pip install --target="$SITE_PKG" $PIP_FLAGS \
        "transformers>=4.40,<5" \
        "huggingface-hub>=0.20,<1.0" \
        "gguf>=0.6" \
        "sentencepiece" \
        "protobuf" \
        "safetensors" \
        "numpy" \
        "torch" 2>&1 | tail -5

    ok "GGUF venv ready at $SITE_PKG"
}

setup_awq() {
    local VENV="$VENVS_DIR/awq"
    local SITE_PKG="$VENV/lib/python$PY_VER/site-packages"
    info "Setting up AWQ venv at $VENV"

    mkdir -p "$SITE_PKG"
    # AWQ needs CUDA torch and newer transformers
    pip install --target="$SITE_PKG" $PIP_FLAGS \
        "autoawq>=0.2" \
        "transformers>=4.45" \
        "huggingface-hub>=0.20" \
        "accelerate>=0.25" \
        "safetensors" \
        "sentencepiece" \
        "protobuf" \
        "numpy" 2>&1 | tail -5

    # torch with CUDA should already be installed system-wide or via autoawq deps
    ok "AWQ venv ready at $SITE_PKG"
}

setup_gptq() {
    local VENV="$VENVS_DIR/gptq"
    local SITE_PKG="$VENV/lib/python$PY_VER/site-packages"
    info "Setting up GPTQ venv at $VENV"

    mkdir -p "$SITE_PKG"
    pip install --target="$SITE_PKG" $PIP_FLAGS \
        "auto-gptq>=0.7" \
        "transformers>=4.45" \
        "huggingface-hub>=0.20" \
        "accelerate>=0.25" \
        "safetensors" \
        "sentencepiece" \
        "protobuf" \
        "numpy" \
        "datasets" 2>&1 | tail -5

    ok "GPTQ venv ready at $SITE_PKG"
}

setup_bitnet() {
    local VENV="$VENVS_DIR/bitnet"
    local SITE_PKG="$VENV/lib/python$PY_VER/site-packages"
    info "Setting up BitNet venv at $VENV"

    mkdir -p "$SITE_PKG"
    pip install --target="$SITE_PKG" $PIP_FLAGS \
        "transformers>=4.45" \
        "huggingface-hub>=0.20" \
        "accelerate>=0.25" \
        "safetensors" \
        "sentencepiece" \
        "protobuf" \
        "numpy" \
        "torch" 2>&1 | tail -5

    ok "BitNet venv ready at $SITE_PKG"
}

setup_mlx() {
    # MLX venv (Apple Silicon only)
    if [[ "$(uname)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
        warn "Skipping MLX venv (not Apple Silicon)"
        return 0
    fi

    local VENV="$VENVS_DIR/mlx"
    local SITE_PKG="$VENV/lib/python$PY_VER/site-packages"
    info "Setting up MLX venv at $VENV"

    mkdir -p "$SITE_PKG"
    pip install --target="$SITE_PKG" $PIP_FLAGS \
        "mlx>=0.4" \
        "mlx-lm>=0.4" \
        "transformers>=4.45" \
        "huggingface-hub>=0.20" \
        "safetensors" \
        "sentencepiece" \
        "protobuf" \
        "numpy" 2>&1 | tail -5

    ok "MLX venv ready at $SITE_PKG"
}

# Main
TARGET="${1:-all}"

case "$TARGET" in
    gguf)   setup_gguf ;;
    awq)    setup_awq ;;
    gptq)   setup_gptq ;;
    bitnet) setup_bitnet ;;
    mlx)    setup_mlx ;;
    all)
        info "Setting up all venvs..."
        setup_gguf
        setup_awq
        setup_gptq
        setup_bitnet
        setup_mlx
        echo ""
        ok "All venvs ready!"
        ;;
    *)
        err "Unknown venv: $TARGET"
        echo "Usage: $0 [gguf|awq|gptq|bitnet|mlx|all]"
        exit 1
        ;;
esac

echo ""
info "Venv directories:"
for d in "$VENVS_DIR"/*/; do
    if [ -d "$d" ]; then
        size=$(du -sh "$d" 2>/dev/null | cut -f1)
        echo "  $(basename "$d"): $size"
    fi
done
