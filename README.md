# QpiAI Nexus — Hardware-Aware LLM Deployment Platform

A multi-platform system for intelligent deployment, quantization, fine-tuning, and inference of large language models across heterogeneous hardware — from cloud GPUs to mobile phones.

[![Nexus demo](llm-integration-platform/public/NexusV7.gif)](llm-integration-platform/public/NexusV7.mp4)

▶ **[Watch the full video with audio](llm-integration-platform/public/NexusV7.mp4)** (1 min, 1080p)

*A full walkthrough of the Nexus platform — hardware-aware model selection, quantization, fine-tuning, vision training, multi-device deployment, and real-time monitoring.*

## Quick Start (Docker)

The fastest way to run Nexus:

```bash
# 1. Clone the repo
git clone https://github.com/qpiai/nexus.git && cd nexus

# 2. Add your API keys
cp .env.example .env
# Edit .env and add at minimum: GEMINI_API_KEY

# 3. Start Nexus
docker compose up -d

# 4. Open in browser
open http://localhost:7777
```

On first startup, the GGUF Python environment is automatically installed (~1GB, takes 2-3 minutes). Subsequent starts are instant since venvs are persisted in a Docker volume.

### Default Login

A default admin account is created automatically on first run:

| | |
|---|---|
| **Username** | `admin` |
| **Password** | `qpiai-nexus` |

**Change the password immediately** after first login: go to **Profile** (click your avatar in the sidebar) → **Change Password**.

### Controlling Python Environments

The `SETUP_VENVS` variable controls which ML backends are installed:

```bash
# Default: GGUF only (recommended, ~1GB)
docker compose up -d

# GGUF + AWQ quantization
SETUP_VENVS=gguf,awq docker compose up -d

# All quantization methods (~3GB)
SETUP_VENVS=all docker compose up -d

# No ML — just the web UI (instant start, quantization disabled)
SETUP_VENVS= docker compose up -d
```

### Docker Commands

```bash
docker compose up -d          # Start in background
docker compose logs -f        # View logs
docker compose down           # Stop
docker compose up -d --build  # Rebuild after code changes

# Reset everything (removes models, venvs, user data)
docker compose down -v
```

---

## Quick Start (Local Development)

```bash
cd llm-integration-platform
npm install
cp .env.example .env.local    # Add your API keys
PORT=7777 npm run dev         # Start dev server

# Optional: set up Python venvs for quantization
bash scripts/setup_venvs.sh gguf    # Just GGUF (~1GB)
bash scripts/setup_venvs.sh         # All methods
```

Default login: `admin` / `qpiai-nexus` (change in Profile → Change Password after first login).

---

## API Keys

Configure in `.env` (Docker) or `llm-integration-platform/.env.local` (local dev):

| Key | Provider | Purpose | Required? |
|---|---|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | AI agent reasoning (Gemini 2.0 Flash) | Yes |
| `TAVILY_API_KEY` | [Tavily](https://tavily.com/) | Web search for agent research | Optional |
| `HF_TOKEN` | [HuggingFace](https://huggingface.co/settings/tokens) | Downloading gated models | Optional |
| `GOOGLE_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) | Google OAuth login | Optional |
| `GOOGLE_CLIENT_SECRET` | Same as above | Google OAuth login | Optional |

At minimum you need `GEMINI_API_KEY` for the AI agent workflow. Everything else is optional.

---

## Repository Structure

```
nexus/
├── llm-integration-platform/     # Web app & backend (Next.js 14 + Python)
├── nexus-android-v7/             # Android client (Kotlin, agent + VLM + vision + QR login)
├── nexus-ios/                    # iOS/macOS client (Swift 6 + MLX)
├── nexus-desktop-v2/             # Desktop client (Electron + node-llama-cpp)
├── nexus_mobile/                 # Cross-platform mobile (Flutter)
├── Dockerfile                    # Docker build (multi-stage)
├── docker-compose.yml            # One-command deployment
├── docker-entrypoint.sh          # Auto venv setup on first run
├── LICENSE                       # Apache 2.0
└── CONTRIBUTING.md               # Contribution guidelines
```

---

## Components

### Web Platform — `llm-integration-platform/`

The core platform. A Next.js 14 application with 15 pages, 47 API routes, and 19 Python scripts for ML operations.

**Key capabilities:**
- 4-agent AI workflow (Research → Reasoning → Critic → Orchestrator) powered by Gemini 2.0 Flash + Tavily search
- 93-model catalog (LLaMA 3, Phi-4, Qwen, Mistral, DeepSeek-R1, Gemma 3, etc.)
- 6 quantization methods: GGUF, AWQ, GPTQ, BitNet, MLX, FP16
- LLM fine-tuning with LoRA/QLoRA
- YOLO vision training with export to ONNX, TensorRT, CoreML, TFLite, OpenVINO, NCNN
- Real-time chat inference with quantized models
- Device management with QR code pairing
- Live system monitoring (CPU, GPU, memory, power)
- JWT auth with Google OAuth support

**Tech stack:** Next.js 14, React 18, TypeScript, Tailwind CSS, Python, PyTorch, Transformers, llama.cpp

---

### Python Environments (venvs)

Quantization and inference require isolated Python environments because different methods need different package versions (e.g., GGUF needs `transformers<5`, while AWQ needs `transformers>=5`).

| Venv | Size | Packages | Used by |
|------|------|----------|---------|
| `gguf` | ~1 GB | transformers<5, huggingface-hub, gguf, torch | GGUF quantization + inference |
| `awq` | ~1 GB | autoawq, transformers>=5, accelerate | AWQ quantization |
| `gptq` | ~1 GB | auto-gptq, transformers>=5, datasets | GPTQ quantization |

**Docker:** Venvs are auto-installed on first run based on `SETUP_VENVS` and persisted in a Docker volume.

**Local dev:** Run the setup script:
```bash
cd llm-integration-platform

# Option A: pip-based (works everywhere)
bash scripts/setup_venvs.sh gguf       # Single method
bash scripts/setup_venvs.sh            # All methods

# Option B: uv-based (faster, needs uv installed)
bash scripts/setup_all_venvs.sh gguf   # Single method
bash scripts/setup_all_venvs.sh        # All methods
```

---

### Android — `nexus-android-v7/`

Kotlin Android app with on-device agent system, inference, and vision capabilities.

**Features:**
- On-device agent system (ReAct + 9 tools) with llama.cpp JNI
- VLM chat with image attachment (base64 encoding)
- On-device TFLite object detection + segmentation (YOLO)
- Server-side vision inference
- Confidence/IoU controls, vision model download/management
- QR code login, email/password auth, and offline mode

```bash
cd nexus-android-v7/app/src/main/cpp
git clone https://github.com/ggerganov/llama.cpp
cd ../../../../..
./gradlew assembleDebug
```

---

### iOS/macOS — `nexus-ios/`

Native Swift 6 client with two targets:

| Target | Description |
|---|---|
| **NexusApp** | Device monitoring, vision inference, chat with server-side models |
| **NexusChat** | On-device LLM inference using MLX with 4 pre-configured models |

```bash
open nexus-ios/NexusApp/NexusApp.xcodeproj
# Build & run in Xcode (requires macOS + Apple Silicon for MLX)
```

---

### Desktop — `nexus-desktop-v2/`

Electron desktop application with local LLM inference via `node-llama-cpp`.

```bash
cd nexus-desktop-v2
npm install
npm start                    # Development
npm run build                # Build all platforms
```

---

### Flutter — `nexus_mobile/`

Cross-platform mobile client built with Flutter + Riverpod + Hive.

```bash
cd nexus_mobile
flutter pub get
flutter build apk           # Android
flutter build ios            # iOS
```

---

## Architecture

```
                        ┌──────────────────────┐
                        │   Nexus Web Platform  │
                        │   (Next.js + Python)  │
                        │                       │
                        │  • Agent Workflow      │
                        │  • Quantization        │
                        │  • Fine-tuning         │
                        │  • Vision Training     │
                        │  • Model Serving       │
                        └───────┬──────┬────────┘
                           API  │      │  SSE
              ┌─────────┬──────┴──────┴──────┬──────────┐
              │         │                    │          │
        ┌─────┴──┐ ┌────┴───┐ ┌─────────┐ ┌─┴────────┐
        │  iOS   │ │Android │ │ Flutter │ │ Electron │
        │(Swift) │ │(Kotlin)│ │ (Dart)  │ │(Desktop) │
        │        │ │        │ │         │ │          │
        │ MLX    │ │TFLite  │ │         │ │ llama    │
        │on-device│ │llama.cpp│ │        │ │ .cpp     │
        └────────┘ └────────┘ └─────────┘ └──────────┘
```

**On-device inference:**
- **iOS/macOS**: MLX framework (Apple Silicon GPUs)
- **Android**: TFLite (vision) + llama.cpp via NDK (LLMs)
- **Desktop**: node-llama-cpp (CPU/GPU)

All clients connect to the web platform via REST API + SSE for server-side operations and can also run inference locally without a server connection.

---

## Environment Requirements

| Component | Requirements |
|---|---|
| Docker deployment | Docker 20+, Docker Compose v2 |
| Local web platform | Node.js 18+, Python 3.10+, cmake |
| iOS | macOS, Xcode 15+, Apple Silicon (for MLX) |
| Android | Android Studio, SDK 35, NDK 27, CMake |
| Flutter | Flutter SDK 3.16+, Dart 3.2+ |
| Desktop | Node.js 18+ |

---

## Testing

```bash
cd llm-integration-platform
npm test                       # Run all tests
npm run lint                   # ESLint
npm run build                  # Production build
```

---

## License

Copyright 2024-2026 QpiAI. Licensed under the [Apache License 2.0](LICENSE).

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.
