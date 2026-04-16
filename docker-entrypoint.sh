#!/bin/bash
set -e

# ============================================================
# QpiAI Nexus — Docker Entrypoint
# ============================================================
# On first run, sets up Python venvs using uv (fast & isolated).
# Venvs are stored in /app/venvs/ (Docker volume = persisted).
# Then starts the Next.js server.
# ============================================================

VENVS_DIR="/app/venvs"
REQS_DIR="/app/scripts/requirements"
SETUP_LOG_DIR="/app/data/setup-logs"
UV_BIN="${UV_BIN:-$(command -v uv 2>/dev/null || echo /root/.local/bin/uv)}"
PYTHON_VERSION="3.11"

info()  { echo -e "\033[1;34m[Nexus]\033[0m $*"; }
ok()    { echo -e "\033[1;32m[Nexus]\033[0m $*"; }
warn()  { echo -e "\033[1;33m[Nexus]\033[0m $*"; }

# -----------------------------------------------------------
# Setup a uv venv from a requirements file
# Usage: setup_venv <name> <python_version>
# -----------------------------------------------------------
setup_venv() {
    local name="$1"
    local pyver="${2:-$PYTHON_VERSION}"
    local venv_dir="$VENVS_DIR/$name"
    local reqs_file="$REQS_DIR/${name}.txt"
    local sentinel="$venv_dir/.nexus-setup-complete"
    local log_file="$SETUP_LOG_DIR/${name}.log"

    # Sentinel is written only after a successful `uv pip install`, so a
    # half-installed venv from a previous interrupted/OOM'd run will be
    # detected and repaired instead of silently skipped.
    if [ -f "$sentinel" ]; then
        info "$name venv already set up, skipping"
        return 0
    fi

    if [ ! -f "$reqs_file" ]; then
        warn "Requirements file not found: $reqs_file — skipping $name"
        return 0
    fi

    # If a broken venv exists (directory present but no sentinel), wipe it
    # so uv can recreate cleanly.
    if [ -d "$venv_dir" ]; then
        warn "$name venv is incomplete (no sentinel) — recreating"
        rm -rf "$venv_dir"
    fi

    info "Setting up $name venv (Python $pyver)..."
    mkdir -p "$SETUP_LOG_DIR"
    : > "$log_file"

    # Create isolated venv with uv
    "$UV_BIN" venv "$venv_dir" --python "$pyver" --quiet >> "$log_file" 2>&1 || {
        warn "Failed to create $name venv with Python $pyver, trying default interpreter..."
        "$UV_BIN" venv "$venv_dir" --quiet >> "$log_file" 2>&1
    }

    # Install packages. Don't let a failure here abort the whole entrypoint —
    # we still want the web server to come up so the user sees the error in
    # the UI rather than a crash-looping container.
    if "$UV_BIN" pip install -r "$reqs_file" --python "$venv_dir/bin/python" --quiet >> "$log_file" 2>&1; then
        touch "$sentinel"
        ok "$name venv ready ($(du -sh "$venv_dir" 2>/dev/null | cut -f1))"
    else
        rm -f "$sentinel"
        rm -rf "$venv_dir"
        warn "$name venv install failed — removed incomplete environment"
        warn "Setup log: $log_file"
        tail -n 20 "$log_file" 2>/dev/null || true
    fi
}

# -----------------------------------------------------------
# Venv setup based on SETUP_VENVS environment variable
# -----------------------------------------------------------
# SETUP_VENVS=gguf          → only GGUF
# SETUP_VENVS=gguf,awq      → GGUF + AWQ
# SETUP_VENVS=all           → all available venvs
# SETUP_VENVS unset/empty   → skip (server starts without ML)
# -----------------------------------------------------------

if [ -n "$SETUP_VENVS" ]; then
    # Verify uv is available
    if ! "$UV_BIN" --version &>/dev/null; then
        warn "uv not found. Installing..."
        curl -LsSf https://astral.sh/uv/install.sh | sh
        UV_BIN="$HOME/.local/bin/uv"
    fi

    info "SETUP_VENVS=$SETUP_VENVS — checking Python environments..."
    echo ""

    if [ "$SETUP_VENVS" = "all" ]; then
        # Setup all venvs that have requirements files
        for req_file in "$REQS_DIR"/*.txt; do
            [ -f "$req_file" ] || continue
            name=$(basename "$req_file" .txt)
            # Skip MLX on non-macOS
            if [ "$name" = "mlx" ] && [ "$(uname)" != "Darwin" ]; then
                info "Skipping MLX (Apple Silicon only)"
                continue
            fi
            # Finetune needs Python 3.10
            if [ "$name" = "finetune" ] || [ "$name" = "vision" ]; then
                setup_venv "$name" "3.10"
            else
                setup_venv "$name" "$PYTHON_VERSION"
            fi
        done
    else
        IFS=',' read -ra VENV_LIST <<< "$SETUP_VENVS"
        for venv in "${VENV_LIST[@]}"; do
            venv=$(echo "$venv" | xargs)  # trim whitespace
            if [ "$venv" = "finetune" ] || [ "$venv" = "vision" ]; then
                setup_venv "$venv" "3.10"
            else
                setup_venv "$venv" "$PYTHON_VERSION"
            fi
        done
    fi
    echo ""
fi

# Show venv status
if [ -d "$VENVS_DIR" ] && [ "$(ls -A "$VENVS_DIR" 2>/dev/null)" ]; then
    info "Python environments:"
    for d in "$VENVS_DIR"/*/; do
        if [ -d "$d" ]; then
            name=$(basename "$d")
            size=$(du -sh "$d" 2>/dev/null | cut -f1)
            if [ -f "$d/.nexus-setup-complete" ]; then
                pyver=$("$d/bin/python" --version 2>/dev/null || echo "N/A")
                echo "  $name: $size ($pyver)"
            else
                echo "  $name: incomplete setup"
            fi
        fi
    done
else
    warn "No Python venvs found. Quantization/inference routes will return setup instructions."
    warn "Set SETUP_VENVS=gguf (or all) to auto-install on next restart."
fi

echo ""
info "Starting Nexus on port ${PORT:-7777}..."

exec "$@"
