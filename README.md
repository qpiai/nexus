# QpiAI Nexus

**The open-source edge intelligence platform — from cloud GPUs to phones.**

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Hugging Face](https://img.shields.io/badge/🤗-Hugging_Face-yellow)](https://huggingface.co/qpiai)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-3776AB.svg?logo=python&logoColor=white)](https://www.python.org/)
[![Docker Ready](https://img.shields.io/badge/docker-ready-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)

[![Nexus demo](llm-integration-platform/public/NexusV7.gif)](llm-integration-platform/public/NexusV7.mp4)

▶ **[Watch the full video with audio](llm-integration-platform/public/NexusV7.mp4)** (1 min · 1080p)

---

## 🎯 Our Mission

> Nexus exists to **democratize AI** and **empower every device**. Any model, any hardware — from cloud GPUs to the phone in your pocket — deployed with one workflow, no cloud lock-in required.

---

## ✨ What you can do with Nexus

- 🤖 Let an AI agent pick the right model + quantization for your hardware
- 🔧 Quantize with **GGUF, AWQ, GPTQ, BitNet, MLX**, or keep **FP16**
- 🎓 Fine-tune with **LoRA** or **QLoRA** directly in your browser
- 🖼️ Train **YOLO** vision models and export to ONNX, TensorRT, CoreML, TFLite, OpenVINO, NCNN
- 📱 Deploy the same workflow to **iOS, Android, desktop, edge, or cloud**
- 📊 Watch **CPU, GPU, memory, power, and throughput** live across every device

---

## 🚀 Quick Start (Docker)

```bash
# 1. Clone
git clone https://github.com/qpiai/nexus.git && cd nexus

# 2. Add your API keys
cp .env.example .env    # add at least GEMINI_API_KEY

# 3. Start Nexus
docker compose up -d

# 4. Open in browser
open http://localhost:7777
```

On first startup the GGUF Python environment installs automatically (~1 GB, 2–3 minutes). Subsequent starts are instant — venvs persist in a Docker volume.

### First login

| | |
|---|---|
| **Username** | `admin` |
| **Password** | `qpiai-nexus` |

Please change the password on first login → click your avatar → **Profile** → **Change Password**.

### Choose which backends to install

```bash
docker compose up -d                              # GGUF only (default, ~1 GB)
SETUP_VENVS=gguf,awq docker compose up -d         # GGUF + AWQ
SETUP_VENVS=all docker compose up -d              # Everything (~3 GB)
SETUP_VENVS= docker compose up -d                 # Web UI only, instant start
```

### Everyday commands

```bash
docker compose up -d           # Start in background
docker compose logs -f         # Follow logs
docker compose down            # Stop
docker compose up -d --build   # Rebuild after code changes
docker compose down -v         # Reset (wipes models, venvs, user data)
```

---

## 🛠️ Local Development

```bash
cd llm-integration-platform
npm install
cp .env.example .env.local      # add API keys
PORT=7777 npm run dev           # start dev server

# Optional: set up Python venvs for quantization
bash scripts/setup_venvs.sh gguf    # just GGUF (~1 GB)
bash scripts/setup_venvs.sh         # all methods
```

Default login: `admin` / `qpiai-nexus`.

---

## 🔑 API Keys

Configure in `.env` (Docker) or `llm-integration-platform/.env.local` (local dev):

| Key | Provider | Purpose | Required? |
|---|---|---|---|
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | AI agent reasoning (Gemini 2.0 Flash) | **Yes** |
| `TAVILY_API_KEY` | [Tavily](https://tavily.com/) | Web search for agent research | Optional |
| `HF_TOKEN` | [HuggingFace](https://huggingface.co/settings/tokens) | Downloading gated models | Optional |
| `GOOGLE_CLIENT_ID` | [Google Cloud Console](https://console.cloud.google.com/apis/credentials) | Google OAuth login | Optional |
| `GOOGLE_CLIENT_SECRET` | Same as above | Google OAuth login | Optional |

Only `GEMINI_API_KEY` is required. Everything else is opt-in.

---

## 📁 Repository Structure

```
nexus/
├── llm-integration-platform/     # Web app & backend (Next.js 14 + Python)
├── nexus-android-v7/             # Android (Kotlin · agent + VLM + vision + QR login)
├── nexus-ios/                    # iOS / macOS (Swift 6 + MLX)
├── nexus-desktop-v2/             # Desktop (Electron + node-llama-cpp)
├── nexus_mobile/                 # Cross-platform mobile (Flutter)
├── Dockerfile                    # Docker build (multi-stage)
├── docker-compose.yml            # One-command deployment
├── docker-entrypoint.sh          # Auto venv setup on first run
├── LICENSE                       # Apache 2.0
└── CONTRIBUTING.md               # Contribution guidelines
```

---

## 🏗️ Architecture

```mermaid
graph LR
    A[👤 User's Hardware Specs] --> B[🧭 Nexus Platform]
    B --> C{🤖 4-Agent Pipeline}
    C --> D[🔍 Research]
    C --> E[🧠 Reasoning]
    C --> F[🛡️ Critic]
    C --> G[📋 Orchestrator]
    D --> H[⚙️ Optimal Deployment Config]
    E --> H
    F --> H
    G --> H
    H --> I[🔧 Quantize]
    H --> J[🎓 Fine-tune]
    H --> K[🖼️ Vision Train]
    I --> L[📦 Model Artifact]
    J --> L
    K --> L
    L --> M[📱 iOS · MLX]
    L --> N[🤖 Android · TFLite + llama.cpp]
    L --> O[💻 Desktop · node-llama-cpp]
    L --> P[☁️ Cloud · Server]
```

**On-device inference everywhere:**

- **iOS / macOS** — MLX (Apple Silicon GPUs)
- **Android** — TFLite (vision) + llama.cpp via NDK (LLMs)
- **Desktop** — node-llama-cpp (CPU / GPU)

All clients talk to the web platform over REST + SSE and can also run inference locally without a server connection.

---

## 📦 Components

### Web Platform — `llm-integration-platform/`

The core of Nexus: a Next.js 14 app with 15 pages, 47 API routes, and 19 Python scripts handling the ML side.

**Highlights:** 4-agent AI workflow on Gemini 2.0 Flash + Tavily · 100+ model catalog (LLaMA 3, Phi-4, Qwen, Mistral, DeepSeek-R1, Gemma 3…) · 6 quantization methods · LoRA/QLoRA fine-tuning · YOLO vision training with 6 export formats · real-time chat with quantized models · device management with QR pairing · live system telemetry · JWT auth + optional Google OAuth.

**Tech stack:** Next.js 14 · React 18 · TypeScript · Tailwind · Python · PyTorch · Transformers · llama.cpp

---

### 🐍 Python Environments

Different quantization methods need different package versions, so each runs in its own isolated venv.

| Venv | Size | Packages | Used by |
|---|---|---|---|
| `gguf` | ~1 GB | transformers<5, huggingface-hub, gguf, torch | GGUF quantization + inference |
| `awq` | ~1 GB | autoawq, transformers>=5, accelerate | AWQ quantization |
| `gptq` | ~1 GB | auto-gptq, transformers>=5, datasets | GPTQ quantization |

**Docker** installs them automatically via `SETUP_VENVS`. **Local dev:**

```bash
cd llm-integration-platform
bash scripts/setup_venvs.sh gguf       # pip-based, one method
bash scripts/setup_venvs.sh            # pip-based, all methods
bash scripts/setup_all_venvs.sh gguf   # uv-based (faster, needs uv)
```

---

### 🤖 Android — `nexus-android-v7/`

Kotlin app with an on-device agent, inference, and vision. ReAct-style agent with 9 tools (llama.cpp JNI) · VLM chat with image attachment · on-device TFLite object detection + segmentation (YOLO) · server-side vision fallback · confidence / IoU controls · QR code login, email/password auth, offline mode.

```bash
cd nexus-android-v7/app/src/main/cpp
git clone https://github.com/ggerganov/llama.cpp
cd ../../../../..
./gradlew assembleDebug
```

---

### 📱 iOS / macOS — `nexus-ios/`

A native Swift 6 client with two targets:

| Target | What it does |
|---|---|
| **NexusApp** | Device monitoring, vision inference, chat with server-side models |
| **NexusChat** | On-device LLM inference using MLX, with 4 pre-configured models |

```bash
open nexus-ios/NexusApp/NexusApp.xcodeproj
# Requires macOS + Apple Silicon for MLX
```

---

### 💻 Desktop — `nexus-desktop-v2/`

Electron desktop app with local inference via `node-llama-cpp`.

```bash
cd nexus-desktop-v2
npm install
npm start                     # dev
npm run build                 # build for all platforms
```

---

### 🎯 Flutter — `nexus_mobile/`

Cross-platform mobile client built with Flutter + Riverpod + Hive.

```bash
cd nexus_mobile
flutter pub get
flutter build apk             # Android
flutter build ios             # iOS
```

---

## 💻 Environment Requirements

| Component | Requirements |
|---|---|
| Docker deployment | Docker 20+, Docker Compose v2 |
| Local web platform | Node.js 18+, Python 3.10+, cmake |
| iOS | macOS, Xcode 15+, Apple Silicon (for MLX) |
| Android | Android Studio, SDK 35, NDK 27, CMake |
| Flutter | Flutter SDK 3.16+, Dart 3.2+ |
| Desktop | Node.js 18+ |

---

## 🧪 Testing

```bash
cd llm-integration-platform
npm test                      # all tests
npm run lint                  # ESLint
npm run build                 # production build
```

---

## 🤝 Contributing

We'd love your help. Fork the repo, build something, open a PR — see [CONTRIBUTING.md](CONTRIBUTING.md) for the details. Drive-by documentation fixes count too.

---

## ⭐ Star

If you find Nexus useful, please give it a star — it genuinely helps us reach more people who could benefit.

---

## 🌐 More from QpiAI

Check out our other open-source projects at **[github.com/qpiai](https://github.com/qpiai)**.

---

## 📜 License

Copyright 2024–2026 QpiAI. Licensed under the [Apache License 2.0](LICENSE).
