import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function formatChatML(messages: ChatMessage[]): string {
  let prompt = '';
  for (const msg of messages) {
    prompt += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
  }
  prompt += '<|im_start|>assistant\n';
  return prompt;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { model, method, messages, maxTokens = 512, image } = body;

  if (!model || !method || !messages || !Array.isArray(messages)) {
    return new Response(
      JSON.stringify({ error: 'Missing model, method, or messages' }),
      { status: 400 }
    );
  }

  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const projectRoot = process.cwd();
  const scriptsDir = path.resolve(projectRoot, 'scripts');

  const methodUpper = method.toUpperCase();

  // MLX only works on macOS Apple Silicon
  if (methodUpper === 'MLX' && process.platform !== 'darwin') {
    return new Response(
      JSON.stringify({ error: 'MLX inference requires Apple Silicon. Use a different model format.' }),
      { status: 400 }
    );
  }

  const isGGUF = methodUpper === 'GGUF';

  // Reject image attachment for non-VLM methods
  if (image && isGGUF) {
    return new Response(
      JSON.stringify({ error: 'Image input is not supported with GGUF models. Use an FP16/VLM model for vision tasks.' }),
      { status: 400 }
    );
  }
  if (image && !['FP16', 'VLM'].includes(methodUpper)) {
    return new Response(
      JSON.stringify({ error: `Image input is not supported with ${methodUpper} models. Use an FP16/VLM model for vision tasks.` }),
      { status: 400 }
    );
  }

  // Resolve model path: check user-specific dir first, then legacy root (admin only)
  const isAdmin = user?.role === 'admin';
  const userOutputDir = path.resolve(projectRoot, 'output', userId);
  const rootOutputDir = path.resolve(projectRoot, 'output');
  let modelPath = path.join(userOutputDir, model);
  if (!fs.existsSync(modelPath) && isAdmin) {
    modelPath = path.join(rootOutputDir, model);
  }

  if (isGGUF) {
    if (!fs.existsSync(modelPath)) {
      return new Response(
        JSON.stringify({ error: `Model file not found: ${model}` }),
        { status: 404 }
      );
    }
  } else {
    if (!fs.existsSync(modelPath) || !fs.statSync(modelPath).isDirectory()) {
      return new Response(
        JSON.stringify({ error: `Model directory not found: ${model}` }),
        { status: 404 }
      );
    }
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      }

      function finish() {
        if (closed) return;
        closed = true;
        try {
          controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
          controller.close();
        } catch {
          // Already closed
        }
      }

      let proc;

      if (isGGUF) {
        // GGUF: format messages into ChatML, spawn infer_gguf.py
        const chatMLPrompt = formatChatML(messages as ChatMessage[]);
        const scriptPath = path.join(scriptsDir, 'infer_gguf.py');

        const env = {
          ...process.env,
          PATH: `${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
        };

        proc = spawn('python3', [
          scriptPath,
          '--model', modelPath,
          '--prompt', chatMLPrompt,
          '--max-tokens', String(maxTokens),
        ], { env, cwd: projectRoot });
      } else if (image && (methodUpper === 'FP16' || methodUpper === 'VLM')) {
        // VLM inference with image input
        const scriptPath = path.join(scriptsDir, 'infer_vlm.py');
        const venvDir = path.join(projectRoot, 'venvs', 'awq');

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

        // Write base64 image to temp file to avoid CLI arg length limits
        const tmpImagePath = path.join(os.tmpdir(), `nexus-vlm-${Date.now()}.b64`);
        fs.writeFileSync(tmpImagePath, image as string);

        const spawnArgs = [
          scriptPath,
          '--model-dir', modelPath,
          '--messages', JSON.stringify(messages),
          '--max-tokens', String(maxTokens),
          '--image-file', tmpImagePath,
        ];

        proc = spawn('python3', spawnArgs, { env, cwd: projectRoot });
        proc.on('close', () => {
          try { fs.unlinkSync(tmpImagePath); } catch { /* ignore */ }
        });
      } else if (methodUpper === 'FP16') {
        // FP16 (unquantized) model: use AWQ venv (has transformers + torch)
        const scriptPath = path.join(scriptsDir, 'infer_fp16.py');
        const venvDir = path.join(projectRoot, 'venvs', 'awq');

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

        proc = spawn('python3', [
          scriptPath,
          '--model-dir', modelPath,
          '--messages', JSON.stringify(messages),
          '--max-tokens', String(maxTokens),
        ], { env, cwd: projectRoot });
      } else if (methodUpper === 'FINETUNE') {
        // Finetuned LoRA model: use finetune venv + peft
        const scriptPath = path.join(scriptsDir, 'infer_finetune.py');
        const venvDir = path.join(projectRoot, 'venvs', 'finetune');

        const pythonPaths = [
          path.join(venvDir, 'lib', 'python3.10', 'site-packages'),
          path.join(venvDir, 'lib', 'python3.11', 'site-packages'),
          path.join(venvDir, 'lib', 'python3.12', 'site-packages'),
          ...(process.env.PYTHONPATH ? [process.env.PYTHONPATH] : []),
        ].filter(p => fs.existsSync(p)).join(':');

        // Use the finetune venv's Python if available
        const venvPython = path.join(venvDir, 'bin', 'python3');
        const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';

        const env = {
          ...process.env,
          PATH: `${venvDir}/bin:${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
          PYTHONPATH: pythonPaths,
          HF_TOKEN: process.env.HF_TOKEN || '',
        };

        proc = spawn(pythonBin, [
          scriptPath,
          '--adapter-dir', modelPath,
          '--messages', JSON.stringify(messages),
          '--max-tokens', String(maxTokens),
        ], { env, cwd: projectRoot });
      } else {
        // AWQ/GPTQ/BitNet/MLX: pass messages as JSON, spawn respective infer script
        const INFER_SCRIPT_MAP: Record<string, string> = {
          AWQ: 'infer_awq.py',
          GPTQ: 'infer_gptq.py',
          BITNET: 'infer_bitnet.py',
          MLX: 'infer_mlx.py',
        };
        const INFER_VENV_MAP: Record<string, string> = {
          AWQ: 'awq',
          GPTQ: 'gptq',
          BITNET: 'bitnet',
          MLX: 'mlx',
        };

        const inferScript = INFER_SCRIPT_MAP[methodUpper] || 'infer_awq.py';
        const inferVenv = INFER_VENV_MAP[methodUpper] || 'awq';
        const scriptPath = path.join(scriptsDir, inferScript);
        const venvDir = path.join(projectRoot, 'venvs', inferVenv);

        // Build PYTHONPATH — include both venv root and standard site-packages
        const pythonPaths = [
          venvDir,
          path.join(venvDir, 'lib', 'python3.12', 'site-packages'),
          path.join(venvDir, 'lib', 'python3.11', 'site-packages'),
          ...(process.env.PYTHONPATH ? [process.env.PYTHONPATH] : []),
        ].filter(p => fs.existsSync(p)).join(':');

        if (!fs.existsSync(venvDir)) {
          send('error', { message: `Virtual environment not found: ${inferVenv}. Run setup script first.` });
          finish();
          return;
        }

        const env = {
          ...process.env,
          PATH: `${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
          PYTHONPATH: pythonPaths,
          HF_TOKEN: process.env.HF_TOKEN || '',
        };

        proc = spawn('python3', [
          scriptPath,
          '--model-dir', modelPath,
          '--messages', JSON.stringify(messages),
          '--max-tokens', String(maxTokens),
        ], { env, cwd: projectRoot });
      }

      // 2-minute timeout for first output, 5-minute total timeout
      let gotOutput = false;
      const firstOutputTimeout = setTimeout(() => {
        if (!gotOutput) {
          send('error', { message: 'Inference timed out waiting for model to load (2 min). The model may be too large for available memory.' });
          try { proc.kill('SIGTERM'); } catch { /* ignore */ }
        }
      }, 120_000);
      const totalTimeout = setTimeout(() => {
        send('error', { message: 'Inference timed out after 5 minutes.' });
        try { proc.kill('SIGTERM'); } catch { /* ignore */ }
      }, 300_000);
      proc.on('close', () => { clearTimeout(firstOutputTimeout); clearTimeout(totalTimeout); });

      let buffer = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        gotOutput = true;
        clearTimeout(firstOutputTimeout);
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'token') {
              send('token', { type: 'token', text: parsed.text, content: parsed.text });
            } else if (parsed.type === 'done') {
              send('metrics', {
                tokens_generated: parsed.tokens_generated,
                time_ms: parsed.time_ms,
                tokens_per_sec: parsed.tokens_per_sec,
              });
            } else if (parsed.type === 'status') {
              send('status', { message: parsed.text });
            } else if (parsed.type === 'error') {
              send('error', { message: parsed.text });
            }
          } catch {
            // Non-JSON output, skip
          }
        }
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim();
        if (!text) return;
        // Detect OOM errors
        if (text.includes('CUDA out of memory') || text.includes('OutOfMemoryError')) {
          send('error', { message: 'GPU out of memory. Try a smaller model or lower precision.' });
          try { proc.kill('SIGTERM'); } catch { /* ignore */ }
          return;
        }
        if (!text.includes('UserWarning') && !text.includes('FutureWarning')) {
          send('log', { message: text });
        }
      });

      proc.on('close', (code) => {
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.type === 'token') {
              send('token', { type: 'token', text: parsed.text, content: parsed.text });
            } else if (parsed.type === 'done') {
              send('metrics', {
                tokens_generated: parsed.tokens_generated,
                time_ms: parsed.time_ms,
                tokens_per_sec: parsed.tokens_per_sec,
              });
            } else if (parsed.type === 'error') {
              send('error', { message: parsed.text });
            }
          } catch {
            // skip
          }
        }
        if (code !== 0 && code !== null) {
          send('error', { message: `Inference process exited with code ${code}` });
        }
        finish();
      });

      proc.on('error', (err) => {
        send('error', { message: err.message });
        finish();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
