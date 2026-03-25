# QpiAI Nexus - System Documentation

## Quick Access

| Item | Details |
|------|---------|
| **Web App** | Your Cloudflare tunnel URL, port 6001 |
| **Login** | Username: `admin` / Password: `changeme123` |
| **APK Download** | `<tunnel-url>/nexus-v2.apk` (no auth required) |
| **Auth Cookie** | `nexus_auth`, HttpOnly, 7-day expiry |

---

## What is Nexus?

QpiAI Nexus is a hardware-aware LLM quantization, optimization, and edge deployment platform. It takes your device specs, uses a multi-agent AI workflow to recommend the best model + quantization method, then lets you quantize, test, deploy, and run models on-device or via server.

### The Pipeline

```
Device Specs  -->  4-Agent Workflow  -->  Quantization  -->  Chat/Test  -->  Deploy to Edge
     |                   |                     |                |                |
  Home Page         Agents Page          Quantize Page     Chat Page       Deploy/Devices
```

---

## Pages (7 + Login)

| Page | Route | Purpose |
|------|-------|---------|
| **Home** | `/` | Enter device specs (RAM, GPU, storage, device type) |
| **Agents** | `/agents` | 4-agent AI workflow recommends optimal model + method |
| **Quantize** | `/quantize` | Run quantization job with live progress streaming |
| **Chat** | `/chat` | Test quantized models with inference metrics |
| **Deploy** | `/deploy` | Deploy models with lifecycle management |
| **Devices** | `/devices` | Manage registered mobile/edge devices |
| **Metrics** | `/metrics` | Live telemetry, performance charts, alerts |
| **Login** | `/login` | Authentication |

---

## 4-Agent Workflow

The core intelligence of Nexus. Powered by **Gemini 2.0 Flash** + **Tavily Search**.

| Agent | Role | Icon |
|-------|------|------|
| **Research** | Analyzes device specs, searches for quantized LLM options | Bot |
| **Reasoning** | Proposes specific model + method + bit precision | Brain |
| **Critic** | Evaluates feasibility, verifies RAM fit, checks method fit | Alert |
| **Orchestrator** | Synthesizes all agents, outputs final recommendation | Compass |

- Runs **2 iterations** for refinement
- Uses Tavily web search on iteration 1 for latest model info
- Final output format: `RECOMMENDATION: 4-bit GGUF SmolLM2 1.7B`
- User can manually override or refine with feedback

---

## Supported Models (37)

### Small (< 1B params)
- SmolLM2 135M, 360M
- Qwen 2.5 0.5B, Qwen 3 0.6B

### Medium (1-3B params)
- SmolLM2 1.7B, LFM 1.2B
- Qwen 2.5 1.5B/3B, Qwen 3 1.7B
- DeepSeek-R1 1.5B, Gemma 3 1B, Gemma 2 2B
- Llama 3.2 1B/3B

### Large (4-9B params)
- Phi-3 Mini 3.8B, Phi-4 Mini 3.8B
- Qwen 3 4B/8B, Qwen 2.5 7B
- Gemma 3 4B, Gemma 2 9B
- Mistral 7B, Llama 3.1 8B

### Quantization Methods

| Method | Bits | Use Case |
|--------|------|----------|
| **GGUF** | 2, 3, 4, 5, 8, 16 | CPU inference via llama.cpp. Best for mobile/edge |
| **AWQ** | 4, 8 | GPU inference. Fast, low memory |
| **GPTQ** | 2, 3, 4, 8 | GPU inference. Widely supported |
| **BitNet** | 1 | Extreme compression. Experimental |

### RAM Formula
```
Model RAM = (params_billions x bits) / 8 + 15% overhead
Device usable RAM = total_RAM x 70% (30% reserved for OS)
```

---

## API Routes (20)

### Auth
- `POST /api/auth/login` - Login with credentials, returns auth cookie
- `POST /api/auth/logout` - Clear cookie, redirect to login

### Agents
- `POST /api/agents/run` - Execute 4-agent workflow (SSE stream)

### Chat/Inference
- `POST /api/chat` - Run inference on quantized model (SSE token stream)
- `GET /api/chat/models` - List available quantized models

### Quantization
- `POST /api/quantization/run` - Start quantization job (SSE progress)
- `GET /api/quantization/download` - Download quantized model file

### Deploy
- `POST /api/deploy/start` - Create deployment
- `GET /api/deploy/list` - List deployments
- `GET /api/deploy/status` - Get deployment status
- `GET /api/deploy/download` - Download model for deployment
- `POST /api/deploy/validate` - Validate model/method compatibility

### Mobile
- `POST /api/mobile/register` - Register device with hardware specs
- `GET /api/mobile/register` - List registered devices
- `POST /api/mobile/upload` - Queue model push to device
- `GET /api/mobile/ws` - SSE connection for device events
- `GET /api/mobile/models` - List mobile-compatible models

### Telemetry
- `GET /api/telemetry/live` - Live metrics SSE stream
- `GET /api/telemetry/history` - Historical metrics per device
- `POST /api/telemetry/report` - Device sends metrics
- `GET /api/telemetry/alerts` - Get threshold alerts

---

## Available Quantized Models (on server)

| Model | Format | Size |
|-------|--------|------|
| Llama-3.2-1B-Instruct | GGUF Q4_K_M | 807 MB |
| Qwen2.5-0.5B-Instruct | GGUF Q4_K_M | 397 MB |
| Qwen2.5-1.5B-Instruct | GGUF Q3_K_M | 824 MB |
| Qwen2.5-3B-Instruct | GGUF Q2_K | 1.27 GB |
| Qwen3-0.6B | GGUF Q4_K_M | 484 MB |
| Qwen3-4B | GGUF Q4_K_M | 2.49 GB |
| SmolLM2-135M-Instruct | GGUF Q2/Q4/Q5/Q8 | 88-144 MB |
| Gemma-3-4B-IT | GGUF Q4_K_M | 2.48 GB |
| SmolLM2-1.7B-Instruct | AWQ 4-bit | ~1 GB |

---

## Android App (Nexus v2 - JNI)

### Download
APK available at `<tunnel-url>/nexus-v2.apk` (17 MB, no auth needed)

### Features
- **On-Device Inference** - Run GGUF models directly via JNI + llama.cpp (ARM64)
- **Server Inference** - Stream from Nexus server via SSE
- **Model Management** - Download, store, delete models on device
- **Resource Monitoring** - Live RAM, CPU, tokens/sec during inference
- **Device Registration** - Register with Nexus server for remote management
- **Metrics Reporting** - Sends performance data back to server every 15s

### How to Use
1. Install APK on ARM64 Android device (API 28+)
2. Open app, enter your Cloudflare tunnel URL
3. Tap "Connect & Register"
4. Download a model (start small: SmolLM2-135M is ~100MB)
5. Tap "Chat" to start on-device inference

### Architecture
```
MainActivity (Connect, Models, Settings)
    |
    v
ChatActivity (On-Device JNI or Server SSE)
    |
    v
LlamaEngine (Kotlin) --> nexus_llama.so (C++ JNI) --> llama.cpp
```

---

## Flutter Mobile App

Location: `/workspace/nexus_mobile/`

- Flutter 3.16+ / Dart 3.2+
- Riverpod state management + Hive local storage
- WebSocket + HTTP communication
- fl_chart for metrics visualization
- **Note:** Flutter SDK not available in current environment

---

## Tech Stack

### Web (Next.js 14)
- React 18, TypeScript 5, Tailwind CSS 3
- Gemini 2.0 Flash API (3 keys, rotation)
- Tavily Search API (3 keys, rotation)
- SSE streaming for all real-time features
- Jest 30 + Testing Library (69 tests)

### Python Backend
- Quantization scripts for GGUF/AWQ/GPTQ/BitNet
- Inference scripts spawned via child_process
- Isolated virtual environments per method
- llama.cpp built from source (CPU-only)

### Android (Kotlin)
- compileSdk 35, minSdk 28
- OkHttp 4.12 + SSE
- Coroutines for async
- NDK 27 + CMake for native C++ JNI
- llama.cpp compiled as shared library

---

## API Keys

All API keys are configured via environment variables in `.env` (Docker) or `.env.local` (local dev). See `.env.example` for the required keys:

- `GEMINI_API_KEY` — Gemini 2.0 Flash (required for AI agent workflow)
- `TAVILY_API_KEY` — Tavily Search (optional, enables web search in agent research)
- `HF_TOKEN` — HuggingFace Hub (optional, for gated models)

---

## Monitoring Thresholds

| Metric | Warning | Critical |
|--------|---------|----------|
| CPU Usage | 75% | 90% |
| Memory Usage | 80% | 95% |
| GPU Temperature | 75C | 85C |
| Latency | 200ms | 500ms |

---

## Device Classes

| Class | Max RAM | Max Model | Target tok/s |
|-------|---------|-----------|-------------|
| Edge | 8 GB | 2 GB | 5 |
| Mobile | 8 GB | 4 GB | 15 |
| Laptop | 64 GB | 32 GB | 40 |
| Cloud | 640 GB | 300 GB | 200 |

---

*QpiAI Nexus - Edge Intelligence Platform*
