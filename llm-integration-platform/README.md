# Nexus LLM Integration Platform

Hardware-aware LLM deployment platform for quantizing, fine-tuning, and deploying language models across heterogeneous devices — from edge to cloud.

**[Watch the demo video](public/NexusV3.mp4)** — a walkthrough of the full platform (also plays on the home page).

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Environment Variables](#environment-variables)
- [Python Virtual Environments](#python-virtual-environments)
- [Pages & UI](#pages--ui)
- [API Routes](#api-routes)
- [AI Agent Workflow](#ai-agent-workflow)
- [Python Scripts](#python-scripts)
- [Model Catalog](#model-catalog)
- [Vision Pipeline](#vision-pipeline)
- [Companion Clients](#companion-clients)
- [Production Deployment](#production-deployment)
- [Project Structure](#project-structure)

---

## Overview

Nexus is a full-stack platform that takes a device's hardware specifications and intelligently recommends, quantizes, and deploys the optimal LLM configuration. It uses a multi-agent AI system (Research → Reasoning → Critic → Orchestrator) powered by Gemini 2.0 Flash to analyze hardware constraints and select the best model + quantization strategy.

The platform supports:
- **6 quantization methods**: GGUF, AWQ, GPTQ, BitNet, MLX, FP16
- **93+ models**: LLaMA 3, Phi-4, Qwen, Mistral, Gemma 3, DeepSeek-R1, and more
- **Vision fine-tuning**: YOLO object detection & segmentation with export to 6 formats
- **LLM fine-tuning**: LoRA/QLoRA via Unsloth + LLaMA-Factory
- **Real-time streaming**: All long-running ops use Server-Sent Events (SSE)

## Features

| Feature | Description |
|---|---|
| **Agent Workflow** | 4-agent AI pipeline with Tavily web search + Gemini reasoning |
| **Quantization** | GGUF, AWQ, GPTQ, BitNet, MLX with configurable bit depths |
| **Chat Inference** | Test quantized models directly in the browser |
| **Fine-tuning** | LoRA/QLoRA SFT and GRPO training via Unsloth |
| **Vision Training** | YOLO detect/segment with ONNX, TensorRT, CoreML, TFLite export |
| **Device Management** | Register and monitor devices, QR code pairing |
| **Live Monitoring** | Real-time CPU, GPU, memory, power metrics |
| **Model Downloads** | Download from HuggingFace Hub with progress tracking |
| **Auth System** | JWT auth with Google OAuth support |
| **Admin Panel** | User management and system statistics |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Next.js 14 (App Router)               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │  Pages   │  │   API    │  │  Agents  │  │  Auth   │ │
│  │  (15)    │  │  Routes  │  │  Engine  │  │  (JWT)  │ │
│  │          │  │  (47)    │  │          │  │         │ │
│  └──────────┘  └────┬─────┘  └────┬─────┘  └─────────┘ │
│                     │             │                      │
│              ┌──────┴──────┐  ┌───┴────────┐            │
│              │   Python    │  │  Gemini    │            │
│              │   Scripts   │  │  2.0 Flash │            │
│              │   (19)      │  │  + Tavily  │            │
│              └──────┬──────┘  └────────────┘            │
│                     │                                    │
│         ┌───────────┼───────────┐                       │
│         │           │           │                       │
│    ┌────┴───┐  ┌────┴───┐  ┌───┴────┐                  │
│    │  GGUF  │  │  AWQ/  │  │ Vision │                  │
│    │  venv  │  │  GPTQ  │  │  venv  │                  │
│    │        │  │  venvs  │  │ (YOLO) │                  │
│    └────────┘  └────────┘  └────────┘                  │
└─────────────────────────────────────────────────────────┘
         │               │                │
    ┌────┴────┐    ┌─────┴─────┐    ┌─────┴─────┐
    │ llama   │    │ HuggingFace│    │ Ultralytics│
    │ .cpp    │    │ Hub        │    │ YOLO       │
    └─────────┘    └───────────┘    └───────────┘
```

### Communication Pattern

All long-running operations (quantization, inference, training) follow the same pattern:

1. API route spawns a Python script as a child process
2. Python script emits JSON lines to stdout (`{"type": "progress", "percent": 45}`)
3. API route parses JSON lines and re-emits as Server-Sent Events
4. Frontend consumes SSE stream and updates UI in real-time

## Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Python** 3.10+ (3.11 recommended)
- **uv** >= 0.9 (Python package manager) — [install](https://docs.astral.sh/uv/getting-started/installation/)
- **cmake** (for llama.cpp compilation)
- **Git**
- **CUDA drivers** (optional, for GPU acceleration)
- **HuggingFace account** with access token

## Quick Start

### 1. Install Node.js dependencies

```bash
cd llm-integration-platform
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env.local
# Edit .env.local with your API keys (see Environment Variables section)
```

### 3. Set up Python virtual environments

```bash
# Set up ALL venvs at once
bash scripts/setup_venvs.sh

# Or set up individual venvs
bash scripts/setup_venvs.sh gguf
bash scripts/setup_venvs.sh awq
bash scripts/setup_venvs.sh gptq
bash scripts/setup_venvs.sh bitnet

# Finetune and vision use uv (different Python version / heavier deps)
bash scripts/setup_venv_finetune.sh
bash scripts/setup_venv_vision.sh
```

### 4. Start the development server

```bash
npm run dev
# App runs on http://localhost:3000
```

### 5. Build for production

```bash
npm run build
npm start
# Or use PM2:
npx pm2 start ecosystem.config.js
```

## Environment Variables

Create `.env.local` in the project root (or `.env` if using Docker):

```env
# Gemini 2.0 Flash (required for AI agent workflow)
GEMINI_API_KEY=your_gemini_key

# Tavily Web Search (optional — enables web search in agent research)
TAVILY_API_KEY=your_tavily_key

# HuggingFace Hub (optional — for downloading gated models)
HF_TOKEN=hf_your_token

# Google OAuth (optional — for Google login)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
```

API calls include automatic retries with exponential backoff for rate limits (429 errors).

## Python Virtual Environments

The platform uses isolated Python venvs because different quantization backends require conflicting dependency versions (e.g., GGUF needs `transformers<5` while AWQ needs `transformers>=5`).

### Venv overview

| Venv | Python | Purpose | Key Packages |
|---|---|---|---|
| `gguf` | 3.11 | GGUF quantization & llama.cpp inference | `transformers<5`, `gguf`, `sentencepiece`, `torch` |
| `awq` | 3.11 | AWQ quantization & inference | `autoawq`, `transformers>=4.45`, `accelerate`, `torch` |
| `gptq` | 3.11 | GPTQ quantization & inference | `auto-gptq`, `transformers>=4.45`, `accelerate`, `datasets` |
| `bitnet` | 3.11 | BitNet 1-bit quantization & inference | `transformers>=4.45`, `accelerate`, `torch` |
| `mlx` | 3.11 | MLX quantization (Apple Silicon only) | `mlx`, `mlx-lm`, `transformers>=4.45` |
| `finetune` | 3.10 | LLM fine-tuning (SFT/GRPO) | `unsloth`, `llamafactory`, `trl`, `peft`, `bitsandbytes`, `torch` |
| `vision` | 3.10 | YOLO vision training & export | `ultralytics`, `opencv-python`, `onnxruntime-gpu`, `tensorrt` |

### Setup with uv (recommended)

Each venv has its own requirements file in `scripts/requirements/`:

```bash
# GGUF
uv venv venvs/gguf --python 3.11
uv pip install -r scripts/requirements/gguf.txt --python venvs/gguf/bin/python

# AWQ
uv venv venvs/awq --python 3.11
uv pip install -r scripts/requirements/awq.txt --python venvs/awq/bin/python

# GPTQ
uv venv venvs/gptq --python 3.11
uv pip install -r scripts/requirements/gptq.txt --python venvs/gptq/bin/python

# BitNet
uv venv venvs/bitnet --python 3.11
uv pip install -r scripts/requirements/bitnet.txt --python venvs/bitnet/bin/python

# MLX (Apple Silicon only)
uv venv venvs/mlx --python 3.11
uv pip install -r scripts/requirements/mlx.txt --python venvs/mlx/bin/python

# Fine-tuning (requires Python 3.10 for Unsloth compatibility)
uv venv venvs/finetune --python 3.10
uv pip install -r scripts/requirements/finetune.txt --python venvs/finetune/bin/python

# Vision (YOLO + TensorRT)
uv venv venvs/vision --python 3.10
uv pip install -r scripts/requirements/vision.txt --python venvs/vision/bin/python
```

Or use the one-liner setup script:

```bash
bash scripts/setup_all_venvs.sh
```

### Setup with pip (alternative)

```bash
python3.11 -m venv venvs/gguf
venvs/gguf/bin/pip install -r scripts/requirements/gguf.txt

# Repeat for each venv...
```

### How venvs are used

Python scripts load their venv via `sys.path.insert()`:

```python
SITE_PACKAGES = os.path.join(PROJECT_DIR, "venvs", "gguf", "lib", "python3.11", "site-packages")
sys.path.insert(0, SITE_PACKAGES)
```

This means venvs don't need to be "activated" — they're loaded at script runtime.

## Pages & UI

| Route | Page | Description |
|---|---|---|
| `/` | Home | Device hardware input form — enter specs to get recommendations |
| `/agents` | Agent Workflow | Watch the 4-agent AI pipeline analyze your device in real-time |
| `/pipeline` | Pipeline | Combined view: agents + quantization + fine-tuning panels |
| `/quantize` | Quantization | Select model, method, bit depth — run quantization with live progress |
| `/chat` | Chat | Test inference with quantized models, supports VLM image input |
| `/finetune` | Fine-tuning | Upload datasets, configure LoRA/QLoRA, monitor training |
| `/vision` | Vision | YOLO training: upload dataset, train, export, run inference |
| `/deploy` | Deployment | Push quantized models to registered devices |
| `/devices` | Devices | Register devices via QR code, view status and specs |
| `/monitor` | Monitor | Real-time system metrics: CPU, GPU, memory, power |
| `/downloads` | Downloads | Download models from HuggingFace with progress tracking |
| `/metrics` | Metrics | Historical performance data and charts |
| `/admin` | Admin | User management, system statistics (admin role only) |
| `/login` | Login | Email/password or Google OAuth authentication |
| `/profile` | Profile | User profile, avatar, password change |

## API Routes

### Authentication
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login with email + password |
| `POST` | `/api/auth/signup` | Create new account |
| `POST` | `/api/auth/logout` | Clear session cookie |
| `GET` | `/api/auth/me` | Get current user info |
| `POST` | `/api/auth/change-password` | Change password |
| `POST` | `/api/auth/google` | Initiate Google OAuth |
| `GET` | `/api/auth/callback/google` | Google OAuth callback |

### Agent Workflow
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/agents/run` | Run 4-agent analysis workflow (SSE stream) |

### Quantization
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/quantization/run` | Execute quantization job (SSE stream) |
| `GET` | `/api/quantization/download` | Download quantized model file |

### Chat / Inference
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/chat` | Run inference on a quantized model (SSE stream) |
| `GET` | `/api/chat/models` | List available models for inference |

### Deployment
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/deploy/start` | Start a deployment |
| `GET` | `/api/deploy/status` | Get deployment status |
| `GET` | `/api/deploy/list` | List all deployments |

### Mobile
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/mobile/register` | Register a mobile device |
| `GET` | `/api/mobile/models` | List models available for mobile |
| `POST` | `/api/mobile/upload` | Upload assets to server |
| `GET` | `/api/mobile/qr` | Generate QR code for device pairing |
| `GET/POST` | `/api/mobile/vision/*` | Vision model endpoints for mobile |

### Fine-tuning
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/finetune/run` | Start fine-tuning job (SSE stream) |
| `GET` | `/api/finetune/models` | List fine-tunable models |
| `GET` | `/api/finetune/datasets` | List uploaded datasets |
| `POST` | `/api/finetune/upload-dataset` | Upload training dataset |
| `GET` | `/api/finetune/status` | Get fine-tuning job status |
| `POST` | `/api/finetune/stop` | Stop a running fine-tuning job |

### Vision
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/vision/train` | Start YOLO training (SSE stream) |
| `GET` | `/api/vision/train/runs` | List training runs |
| `POST` | `/api/vision/train/stop` | Stop training |
| `GET` | `/api/vision/models` | List vision models |
| `POST` | `/api/vision/export` | Export model to deployment format |
| `POST` | `/api/vision/infer` | Run vision inference |
| `POST` | `/api/vision/dataset/upload` | Upload vision dataset |
| `POST` | `/api/vision/dataset/prepare` | Prepare dataset for training |
| `GET` | `/api/vision/dataset/list` | List available datasets |

### Telemetry
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/telemetry/live` | Live system metrics (SSE stream) |
| `GET` | `/api/telemetry/history` | Historical metrics data |
| `POST` | `/api/telemetry/report` | Submit telemetry report |
| `GET` | `/api/telemetry/alerts` | Get system alerts |

### Admin
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/users` | List all users (admin only) |
| `GET` | `/api/admin/stats` | System statistics (admin only) |

## AI Agent Workflow

The platform uses a 4-agent iterative pipeline to recommend the optimal model + quantization for a given device:

```
Device Specs → Research Agent → Reasoning Agent → Critic Agent → Orchestrator Agent
                    ↑                                                      │
                    └──────────── Iteration 2 (refinement) ←───────────────┘
```

### Agents

1. **Research Agent** — Searches the web via Tavily for the latest model benchmarks, quantization comparisons, and device-specific optimizations. Provides factual context for the other agents.

2. **Reasoning Agent** — Analyzes device specs + research context. Recommends a specific model, quantization method, and bit depth from the 93-model catalog. Uses RAM safety formula: `model_params × bits / 8 × 1.15 ≤ device_RAM × 0.7`.

3. **Critic Agent** — Validates the recommendation. Checks RAM fit, method compatibility, and whether a better option exists. Flags issues for the next iteration.

4. **Orchestrator Agent** — Synthesizes all agent outputs into a final recommendation in the format: `{bits}-bit {method} {model_name}`.

The pipeline runs 2 iterations for refinement, streaming each agent's output to the UI in real-time.

## Python Scripts

### Quantization Scripts

| Script | Method | Output | Venv |
|---|---|---|---|
| `quantize_gguf.py` | GGUF via llama.cpp | `.gguf` file | `gguf` |
| `quantize_awq.py` | AWQ | HF model directory | `awq` |
| `quantize_gptq.py` | GPTQ | HF model directory | `gptq` |
| `quantize_bitnet.py` | BitNet (1-bit) | HF model directory | `bitnet` |
| `quantize_mlx.py` | MLX (Apple Silicon) | MLX model directory | `mlx` |

### Inference Scripts

| Script | Purpose | Venv |
|---|---|---|
| `infer_gguf.py` | GGUF inference via llama.cpp binary | `gguf` |
| `infer_awq.py` | AWQ model inference | `awq` |
| `infer_gptq.py` | GPTQ model inference | `gptq` |
| `infer_bitnet.py` | BitNet inference with dequantization | `bitnet` |
| `infer_mlx.py` | MLX inference (Apple Silicon) | `mlx` |
| `infer_fp16.py` | Full precision FP16 inference | `awq` |
| `infer_vlm.py` | Vision-Language Model inference | `awq` |
| `infer_finetune.py` | Fine-tuned LoRA model inference | `finetune` |

### Other Scripts

| Script | Purpose | Venv |
|---|---|---|
| `finetune_unsloth.py` | SFT/GRPO fine-tuning with Unsloth | `finetune` |
| `vision_train.py` | YOLO model training | `vision` |
| `vision_infer.py` | YOLO inference on images | `vision` |
| `vision_export.py` | Export YOLO to ONNX/TRT/CoreML/TFLite | `vision` |
| `vision_dataset_prepare.py` | Auto-detect and prepare YOLO datasets | `vision` |
| `download_model.py` | Download models from HuggingFace Hub | `gguf` |

## Model Catalog

The platform supports 93+ models across LLM, VLM, and Vision categories:

### LLMs
- **Tiny** (< 2B): SmolLM 135M/360M/1.7B, Qwen 3.5 0.6B, LFM 1.2B
- **Small** (2-4B): Phi-4 Mini 3.8B, Gemma 3 1B/4B, Llama 3.2 1B/3B, SmolLM3 3B, Qwen 3.5 3B
- **Medium** (7-14B): Llama 3.1 8B, Qwen 3.5 7B/14B, Mistral 7B, Gemma 3 12B, DeepSeek-R1 7B/14B
- **Large** (30B+): Llama 3.1 70B, Qwen 3.5 32B, Mistral Large, DeepSeek-R1 32B/70B

### VLMs (Vision-Language)
- Qwen2.5-VL 3B/7B, SmolVLM 2.2B, Gemma 3 4B Vision

### Vision Models
- YOLO26: nano/small (detect + segment)
- YOLO11: nano/small (detect + segment)

### Supported Quantization per Method

| Method | Bit Depths |
|---|---|
| FP16 | 16 |
| GGUF | 2, 3, 4, 5, 8, 16 |
| AWQ | 4, 8 |
| GPTQ | 2, 3, 4, 8 |
| BitNet | 1 |
| MLX | 4, 8 |

## Vision Pipeline

End-to-end YOLO object detection and segmentation:

```
Upload Dataset → Prepare (auto-detect format) → Train → Export → Inference
```

### Supported formats
- **Input**: YOLO format, COCO JSON (auto-converted), VOC XML
- **Export**: ONNX, TensorRT, CoreML, TFLite, OpenVINO, NCNN
- **Models**: YOLO26n, YOLO26s, YOLO11n, YOLO11s (detect + segment variants)

### Training features
- Configurable epochs, batch size, image size, learning rate
- Per-epoch metric callbacks (mAP, precision, recall, loss)
- Live training progress via SSE
- Graceful stop (finishes current epoch)
- Augmentation, freeze layers, patience for early stopping

## Companion Clients

### Android v7 (`nexus-android-v7/`)
- **Language**: Kotlin
- **Architecture**: Activity-based with on-device agent system (ReAct + 9 tools)
- **Features**: VLM chat, TFLite vision detection & segmentation, llama.cpp JNI, QR login, offline mode
- **Build**: `./gradlew assembleDebug`

### iOS/macOS (`nexus-ios/`)
- **Language**: Swift 6
- **Targets**: NexusApp (device monitoring, vision, chat) and NexusChat (MLX on-device inference)
- **On-device inference**: Uses `mlx-swift-lm` with 4 pre-configured models

### Desktop (`nexus-desktop-v2/`)
- **Framework**: Electron
- **Local inference**: `node-llama-cpp`
- **Targets**: Windows (NSIS), Linux (AppImage/deb), macOS (zip)

### Flutter (`nexus_mobile/`)
- **State management**: Riverpod + Hive
- **Charts**: fl_chart
- **Build**: `flutter build apk`

## Production Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start the app + Cloudflare tunnel
pm2 start ecosystem.config.js

# Monitor
pm2 logs
pm2 monit
```

### Using Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

### Port configuration

- **Development**: `npm run dev` (default port 3000)
- **Production**: Configure in `ecosystem.config.js` (currently port 6001)

## Project Structure

```
llm-integration-platform/
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── page.tsx                  # Home — device input
│   │   ├── layout.tsx                # Root layout
│   │   ├── agents/page.tsx           # Agent workflow UI
│   │   ├── pipeline/page.tsx         # Combined pipeline view
│   │   ├── quantize/page.tsx         # Quantization interface
│   │   ├── chat/page.tsx             # Chat / inference
│   │   ├── finetune/page.tsx         # Fine-tuning UI
│   │   ├── vision/page.tsx           # Vision training UI
│   │   ├── deploy/page.tsx           # Deployment management
│   │   ├── devices/page.tsx          # Device management
│   │   ├── monitor/page.tsx          # Live metrics
│   │   ├── downloads/page.tsx        # Model downloads
│   │   ├── metrics/page.tsx          # Performance metrics
│   │   ├── admin/page.tsx            # Admin panel
│   │   ├── login/page.tsx            # Authentication
│   │   ├── profile/page.tsx          # User profile
│   │   └── api/                      # 47 API routes
│   │       ├── agents/run/           # Agent workflow (SSE)
│   │       ├── auth/                 # Auth endpoints
│   │       ├── chat/                 # Inference endpoints
│   │       ├── quantization/         # Quantization endpoints
│   │       ├── deploy/               # Deployment endpoints
│   │       ├── mobile/               # Mobile device endpoints
│   │       ├── finetune/             # Fine-tuning endpoints
│   │       ├── vision/               # Vision training endpoints
│   │       ├── telemetry/            # Metrics endpoints
│   │       └── admin/                # Admin endpoints
│   ├── lib/
│   │   ├── engines/
│   │   │   ├── agent-system.ts       # 4-agent workflow engine
│   │   │   ├── gemini.ts             # Gemini 2.0 Flash client (3-key rotation)
│   │   │   └── tavily.ts             # Tavily search client (3-key rotation)
│   │   ├── types.ts                  # All TypeScript interfaces
│   │   ├── constants.ts              # 93-model catalog, presets, limits
│   │   ├── auth.ts                   # JWT auth (HMAC-SHA256)
│   │   ├── users.ts                  # User management
│   │   ├── utils.ts                  # Formatting, ID generation
│   │   ├── telemetry.ts              # Metrics collection
│   │   ├── system-metrics.ts         # System info
│   │   ├── finetune-state.ts         # Fine-tune job state
│   │   ├── vision-train-state.ts     # Vision training state
│   │   └── vision-validation.ts      # Input sanitization
│   ├── components/
│   │   ├── ui/                       # Primitives: button, card, input, select, etc.
│   │   ├── pipeline/                 # agent-panel, quantize-panel, finetune-panel
│   │   ├── monitor/                  # metrics-panel, devices-panel, downloads-panel
│   │   ├── qr-mobile-login.tsx        # QR code device pairing
│   │   ├── sidebar.tsx               # Navigation sidebar
│   │   ├── header.tsx                # Top header
│   │   ├── layout-shell.tsx          # Layout wrapper
│   │   └── theme-provider.tsx        # Dark/light mode
│   └── middleware.ts                 # Auth enforcement
├── scripts/
│   ├── requirements/                 # Per-venv requirements files
│   │   ├── gguf.txt
│   │   ├── awq.txt
│   │   ├── gptq.txt
│   │   ├── bitnet.txt
│   │   ├── mlx.txt
│   │   ├── finetune.txt
│   │   └── vision.txt
│   ├── setup_venvs.sh               # Venv setup (pip --target)
│   ├── setup_all_venvs.sh           # One-liner: all venvs via uv
│   ├── quantize_*.py                # 5 quantization scripts
│   ├── infer_*.py                   # 8 inference scripts
│   ├── finetune_unsloth.py          # Fine-tuning script
│   ├── vision_*.py                  # 4 vision scripts
│   └── download_model.py            # Model downloader
├── public/                           # Static assets
├── venvs/                            # Python venvs (gitignored)
├── output/                           # Build artifacts, quantized models (gitignored)
├── data/                             # User data, sessions (gitignored)
├── __tests__/                        # Jest test suites
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── next.config.mjs
├── ecosystem.config.js               # PM2 config
├── jest.config.ts
├── .env.local                        # Environment variables (gitignored)
└── .gitignore
```

## Testing

```bash
# Run all tests
npm test

# Run a specific test file
npx jest __tests__/utils.test.ts

# Run tests matching a pattern
npx jest --testNamePattern="formatBytes"
```

## Notes

- **No persistent database** — All state is in-memory and resets on restart. User accounts persist in `data/` directory (JSON files).
- **RAM safety margin** — The agent system reserves 30% of device RAM for the OS. Formula: `model_params × bits / 8 × 1.15 ≤ device_RAM × 0.7`.
- **CUDA** — Only GPU drivers are needed, not the full CUDA toolkit. llama.cpp builds CPU-only. PyTorch scripts auto-detect GPU availability.
- **3-key rotation** — Gemini and Tavily APIs use 3-key rotation to handle rate limits. The system auto-retries with the next key on 429 errors.
