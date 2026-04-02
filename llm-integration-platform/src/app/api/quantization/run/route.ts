import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { buildModelMap, METHOD_BITS, findModelByRepoId } from '@/lib/constants';
import { getUserFromRequest } from '@/lib/auth';
import { getQuantizeState, resetQuantizeState, pushQuantizeLog } from '@/lib/quantize-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

const MODEL_MAP = buildModelMap();

function resolveModelId(modelName: string): string | null {
  // Direct match
  if (MODEL_MAP[modelName]) return MODEL_MAP[modelName];

  // Fuzzy match (case insensitive, partial)
  const lower = modelName.toLowerCase();
  for (const [key, value] of Object.entries(MODEL_MAP)) {
    if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
      return value;
    }
  }

  // Check common patterns
  if (lower.includes('smollm3') || (lower.includes('smollm') && lower.includes('3b'))) return MODEL_MAP['SmolLM3 3B'];
  if (lower.includes('smollm') || lower.includes('smol')) {
    if (lower.includes('135')) return MODEL_MAP['SmolLM2 135M'];
    if (lower.includes('360')) return MODEL_MAP['SmolLM2 360M'];
    if (lower.includes('1.7') || lower.includes('1b')) return MODEL_MAP['SmolLM2 1.7B'];
    return MODEL_MAP['SmolLM3 3B'];
  }
  if (lower.includes('qwen') && lower.includes('3.5')) {
    if (lower.includes('4b')) return MODEL_MAP['Qwen 3.5 4B'];
    if (lower.includes('9b')) return MODEL_MAP['Qwen 3.5 9B'];
    return MODEL_MAP['Qwen 3.5 4B'];
  }
  if (lower.includes('qwen') && lower.includes('3') && !lower.includes('2.5')) {
    if (lower.includes('0.6')) return MODEL_MAP['Qwen 3 0.6B'];
    if (lower.includes('1.7')) return MODEL_MAP['Qwen 3 1.7B'];
    if (lower.includes('4b')) return MODEL_MAP['Qwen 3 4B'];
    if (lower.includes('8b')) return MODEL_MAP['Qwen 3 8B'];
    return MODEL_MAP['Qwen 3 0.6B'];
  }
  if (lower.includes('qwen')) {
    if (lower.includes('0.5')) return MODEL_MAP['Qwen 2.5 0.5B'];
    if (lower.includes('1.5')) return MODEL_MAP['Qwen 2.5 1.5B'];
    if (lower.includes('3b')) return MODEL_MAP['Qwen 2.5 3B'];
    if (lower.includes('7b')) return MODEL_MAP['Qwen 2.5 7B'];
    return MODEL_MAP['Qwen 2.5 0.5B'];
  }
  if (lower.includes('llama') && lower.includes('3.2')) {
    if (lower.includes('1b')) return MODEL_MAP['Llama 3.2 1B'];
    if (lower.includes('3b')) return MODEL_MAP['Llama 3.2 3B'];
    return MODEL_MAP['Llama 3.2 1B'];
  }
  if (lower.includes('llama') && lower.includes('3.3')) return MODEL_MAP['Llama 3.3 70B'];
  if (lower.includes('llama') && lower.includes('3.1')) return MODEL_MAP['Llama 3.1 8B'];
  if (lower.includes('llama') && lower.includes('70b')) return MODEL_MAP['Llama 3.3 70B'];
  if (lower.includes('llama') && lower.includes('8b')) return MODEL_MAP['Llama 3.1 8B'];
  if (lower.includes('mistral') && (lower.includes('small') || lower.includes('24'))) return MODEL_MAP['Mistral Small 24B'];
  if (lower.includes('mistral')) return MODEL_MAP['Mistral 7B'];
  if (lower.includes('lfm') || lower.includes('liquid')) {
    if (lower.includes('think')) return MODEL_MAP['LFM 1.2B Thinking'];
    return MODEL_MAP['LFM 1.2B'];
  }
  if (lower.includes('deepseek') && lower.includes('7b')) return MODEL_MAP['DeepSeek-R1 7B'];
  if (lower.includes('deepseek') && lower.includes('1.5')) return MODEL_MAP['DeepSeek-R1 1.5B'];
  if (lower.includes('deepseek')) return MODEL_MAP['DeepSeek-R1 1.5B'];
  if (lower.includes('phi') && lower.includes('4')) return MODEL_MAP['Phi-4 Mini 3.8B'];
  if (lower.includes('phi')) return MODEL_MAP['Phi-3 Mini 3.8B'];
  if (lower.includes('gemma') && lower.includes('3n')) return MODEL_MAP['Gemma 3n 2B'];
  if (lower.includes('gemma') && lower.includes('3') && !lower.includes('2')) {
    if (lower.includes('1b')) return MODEL_MAP['Gemma 3 1B'];
    if (lower.includes('4b')) return MODEL_MAP['Gemma 3 4B'];
    return MODEL_MAP['Gemma 3 1B'];
  }
  if (lower.includes('gemma') && lower.includes('2')) {
    if (lower.includes('9b')) return MODEL_MAP['Gemma 2 9B'];
    return MODEL_MAP['Gemma 2 2B'];
  }
  if (lower.includes('gemma')) return MODEL_MAP['Gemma 3 1B'];

  // Already a HF repo ID
  if (modelName.includes('/')) return modelName;

  // Unrecognized model
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { model, method, bits, localModelPath } = body;

  if (!model || !method || !bits) {
    return new Response(JSON.stringify({ error: 'Missing model, method, or bits' }), { status: 400 });
  }

  // Validate method
  const methodUpper = method.toUpperCase();
  const validBits = METHOD_BITS[methodUpper];
  if (!validBits) {
    return new Response(JSON.stringify({ error: `Invalid method "${method}". Supported: GGUF (incl. 16-bit FP16), AWQ, GPTQ, BitNet, MLX` }), { status: 400 });
  }

  // Validate bits for method
  const bitsNum = Number(bits);
  if (!validBits.includes(bitsNum)) {
    return new Response(
      JSON.stringify({ error: `${bitsNum}-bit is not supported for ${methodUpper}. Valid options: ${validBits.join(', ')}-bit` }),
      { status: 400 }
    );
  }

  // Resolve model
  const repoId = resolveModelId(model);
  if (!repoId) {
    return new Response(
      JSON.stringify({ error: `Unrecognized model "${model}". Please select a supported model.` }),
      { status: 400 }
    );
  }

  // Validate model supports the chosen method (case-insensitive comparison)
  const modelMeta = findModelByRepoId(repoId);
  if (modelMeta && !modelMeta.methods.some(m => m.toUpperCase() === methodUpper)) {
    return new Response(
      JSON.stringify({ error: `"${modelMeta.name}" does not support ${methodUpper}. Supported methods: ${modelMeta.methods.join(', ')}` }),
      { status: 400 }
    );
  }

  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const quantizeState = getQuantizeState(userId);

  // Check for running process
  if (quantizeState.process && !quantizeState.process.killed) {
    return new Response(JSON.stringify({ error: 'A quantization job is already running. Please wait for it to complete.' }), { status: 409 });
  }

  // Reset and initialize per-user state
  resetQuantizeState(userId);
  quantizeState.running = true;
  quantizeState.model = repoId;
  quantizeState.method = methodUpper;
  quantizeState.bits = bitsNum;
  quantizeState.startTime = Date.now();

  const projectRoot = process.cwd();
  const outputDir = path.resolve(projectRoot, 'output', userId);
  quantizeState.outputDir = outputDir;
  const scriptsDir = path.resolve(projectRoot, 'scripts');

  const SCRIPT_MAP: Record<string, string> = {
    GGUF: 'quantize_gguf.py',
    AWQ: 'quantize_awq.py',
    GPTQ: 'quantize_gptq.py',
    BITNET: 'quantize_bitnet.py',
    MLX: 'quantize_mlx.py',
    FP16: 'download_model.py',
  };
  const VENV_MAP: Record<string, string> = {
    GGUF: 'gguf',
    AWQ: 'awq',
    GPTQ: 'gptq',
    BITNET: 'bitnet',
    MLX: 'mlx',
    FP16: 'gguf',
  };

  const scriptName = SCRIPT_MAP[methodUpper] || 'quantize_gguf.py';
  const scriptPath = path.join(scriptsDir, scriptName);
  const venvDir = path.join(projectRoot, 'venvs', VENV_MAP[methodUpper] || 'gguf');

  // Pre-flight checks
  if (!fs.existsSync(scriptPath)) {
    return new Response(
      JSON.stringify({ error: `Quantization script not found: ${scriptName}. Server may need setup.` }),
      { status: 500 }
    );
  }
  if (!fs.existsSync(venvDir)) {
    return new Response(
      JSON.stringify({ error: `Python environment not found for ${methodUpper}. Run venv setup first.` }),
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Controller may be closed if client disconnected
          closed = true;
        }
      }

      function sendAndTrack(event: string, data: Record<string, unknown>) {
        send(event, data);

        const msg = (data.message as string) || '';
        const prog = data.progress as number | undefined;

        if (event === 'progress') {
          pushQuantizeLog(userId, { type: 'progress', message: msg, progress: prog });
          if (prog !== undefined) quantizeState.progress = prog;
        } else if (event === 'complete') {
          pushQuantizeLog(userId, { type: 'complete', message: msg, progress: 1.0 });
          quantizeState.progress = 1.0;
          quantizeState.done = true;
          if (data.file) quantizeState.outputFile = data.file as string;
        } else if (event === 'error') {
          pushQuantizeLog(userId, { type: 'error', message: msg });
          quantizeState.error = msg;
        } else if (event === 'log') {
          pushQuantizeLog(userId, { type: 'log', message: msg });
        } else if (event === 'info') {
          pushQuantizeLog(userId, { type: 'info', message: msg || `Starting ${data.method} quantization: ${data.repoId}` });
        }
      }

      function finish() {
        quantizeState.running = false;
        quantizeState.process = null;
        if (closed) return;
        closed = true;
        try {
          controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
          controller.close();
        } catch {
          // Already closed
        }
      }

      sendAndTrack('info', { repoId, method: methodUpper, bits: bitsNum, outputDir });

      // Build PYTHONPATH — include both venv root (--target installs) and
      // standard site-packages layouts (full venv installs)
      const pythonPaths = [
        venvDir,
        path.join(venvDir, 'lib', 'python3.12', 'site-packages'),
        path.join(venvDir, 'lib', 'python3.11', 'site-packages'),
        ...(process.env.PYTHONPATH ? [process.env.PYTHONPATH] : []),
      ].filter(p => fs.existsSync(p)).join(':');

      const env = {
        ...process.env,
        PATH: `${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
        PYTHONPATH: pythonPaths,
        HF_TOKEN: process.env.HF_TOKEN || '',
      };

      const spawnArgs = [
        scriptPath,
        '--model', localModelPath || repoId,
        '--bits', String(bitsNum),
        '--output-dir', outputDir,
      ];

      const proc = spawn('python3', spawnArgs, {
        env,
        cwd: projectRoot,
      });

      quantizeState.process = proc;

      // 2-hour timeout
      const timeout = setTimeout(() => {
        sendAndTrack('error', { message: 'Quantization timed out after 2 hours. Process killed.' });
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 5000);
      }, 2 * 60 * 60 * 1000);

      proc.on('close', () => clearTimeout(timeout));

      let buffer = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            sendAndTrack(parsed.type, parsed);
          } catch {
            sendAndTrack('log', { message: line });
          }
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const lines = chunk.toString().split('\n');
        for (const text of lines) {
          const trimmed = text.trim();
          if (trimmed && !trimmed.startsWith('Downloading') && !trimmed.includes('%|')) {
            sendAndTrack('log', { message: trimmed });
          }
        }
      });

      proc.on('close', (code) => {
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            sendAndTrack(parsed.type, parsed);
          } catch {
            sendAndTrack('log', { message: buffer });
          }
        }
        if (code !== 0 && code !== null) {
          sendAndTrack('error', { message: `Process exited with code ${code}` });
        }
        finish();
      });

      proc.on('error', (err) => {
        sendAndTrack('error', { message: err.message });
        finish();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
