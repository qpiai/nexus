import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getFinetuneState, resetState, pushLog, pushLoss } from '@/lib/finetune-state';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const body = await req.json();
  const { model, dataset, config } = body;

  if (!model || !dataset) {
    return new Response(JSON.stringify({ error: 'Missing model or dataset' }), { status: 400 });
  }

  const finetuneState = getFinetuneState(userId);

  // Check for running process
  if (finetuneState.process && !finetuneState.process.killed) {
    return new Response(JSON.stringify({ error: 'A finetuning job is already running. Please wait for it to complete.' }), { status: 409 });
  }

  const {
    epochs = 3,
    batchSize = 4,
    learningRate = 2e-4,
    loraRank = 16,
    loraAlpha = 32,
    maxSeqLength = 2048,
    finetuningType = 'qlora',
    mergeAdapters = false,
    trainingMode = 'sft',
    rewardType = 'length',
    numGenerations = 4,
    grpoBeta = 0.1,
    isVLM = false,
    maxSamples = 0,
    hfDatasetId = '',
  } = config || {};

  // Use HF dataset ID if provided and not custom upload
  const effectiveDataset = (hfDatasetId && dataset === 'huggingface') ? hfDatasetId : dataset;

  // Reset and initialize per-user state
  resetState(userId);
  finetuneState.running = true;
  finetuneState.model = model;
  finetuneState.dataset = dataset;
  finetuneState.finetuningType = finetuningType;
  finetuneState.trainingMode = trainingMode;
  finetuneState.startTime = Date.now();

  const projectRoot = process.cwd();
  const outputDir = path.resolve(projectRoot, 'output', userId);
  const scriptsDir = path.resolve(projectRoot, 'scripts');
  const scriptPath = path.join(scriptsDir, 'finetune_unsloth.py');
  const venvDir = path.join(projectRoot, 'venvs', 'finetune');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }

      function sendAndTrack(event: string, data: Record<string, unknown>) {
        send(event, data);

        // Push to shared state for persistence
        const msg = (data.message as string) || '';
        const prog = data.progress as number | undefined;

        if (event === 'progress') {
          pushLog(userId, { type: 'progress', message: msg, progress: prog });
          if (prog !== undefined) finetuneState.progress = prog;
        } else if (event === 'loss') {
          pushLog(userId, { type: 'loss', message: msg, progress: prog });
          if (prog !== undefined) finetuneState.progress = prog;
          if (data.loss !== undefined && data.step !== undefined) {
            pushLoss(userId, {
              step: data.step as number,
              loss: data.loss as number,
              learning_rate: data.learning_rate as number | undefined,
              epoch: data.epoch as number | undefined,
            });
          }
        } else if (event === 'complete') {
          pushLog(userId, { type: 'complete', message: msg, progress: 1.0 });
          finetuneState.progress = 1.0;
          finetuneState.done = true;
          if (data.output_dir) finetuneState.outputDir = data.output_dir as string;
          finetuneState.finalResult = data;
        } else if (event === 'error') {
          pushLog(userId, { type: 'error', message: msg });
          finetuneState.error = msg;
        } else if (event === 'warning') {
          pushLog(userId, { type: 'warning', message: msg });
        } else if (event === 'log') {
          pushLog(userId, { type: 'log', message: msg });
        } else if (event === 'info') {
          pushLog(userId, { type: 'info', message: msg || `Starting finetuning: ${data.model}` });
        }
      }

      function finish() {
        if (closed) return;
        closed = true;
        finetuneState.running = false;
        finetuneState.process = null;
        try {
          controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
          controller.close();
        } catch {
          // Already closed
        }
      }

      sendAndTrack('info', { model, dataset, finetuningType, epochs, batchSize });

      // Build PYTHONPATH pointing to site-packages
      const pythonPaths = [
        path.join(venvDir, 'lib', 'python3.10', 'site-packages'),
        path.join(venvDir, 'lib', 'python3.11', 'site-packages'),
        path.join(venvDir, 'lib', 'python3.12', 'site-packages'),
        ...(process.env.PYTHONPATH ? [process.env.PYTHONPATH] : []),
      ].filter(p => fs.existsSync(p)).join(':');

      // Find Python binary in venv (check symlink resolves with fs.realpathSync)
      let pythonBin = 'python3';
      const venvPython = path.join(venvDir, 'bin', 'python3');
      const venvPython2 = path.join(venvDir, 'bin', 'python');
      try {
        fs.realpathSync(venvPython);
        pythonBin = venvPython;
      } catch {
        try {
          fs.realpathSync(venvPython2);
          pythonBin = venvPython2;
        } catch {
          // fallback to system python3
        }
      }

      const env = {
        ...process.env,
        PATH: `${path.join(venvDir, 'bin')}:${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
        PYTHONPATH: pythonPaths,
        HF_TOKEN: process.env.HF_TOKEN || '',
        CUDA_VISIBLE_DEVICES: process.env.CUDA_VISIBLE_DEVICES || '0',
        TORCH_CUDA_ARCH_LIST: process.env.TORCH_CUDA_ARCH_LIST || '',
        TOKENIZERS_PARALLELISM: 'false',
      };

      const cmdArgs = [
        scriptPath,
        '--model', model,
        '--dataset', effectiveDataset,
        '--output-dir', outputDir,
        '--epochs', String(epochs),
        '--batch-size', String(batchSize),
        '--learning-rate', String(learningRate),
        '--lora-rank', String(loraRank),
        '--lora-alpha', String(loraAlpha),
        '--max-seq-length', String(maxSeqLength),
        '--finetuning-type', finetuningType,
        '--training-mode', trainingMode,
        '--reward-type', rewardType,
        '--num-generations', String(numGenerations),
        '--grpo-beta', String(grpoBeta),
      ];

      if (mergeAdapters) {
        cmdArgs.push('--merge-adapters');
      }

      if (isVLM) {
        cmdArgs.push('--vlm');
      }

      if (maxSamples > 0) {
        cmdArgs.push('--max-samples', String(maxSamples));
      }

      const proc = spawn(pythonBin, cmdArgs, {
        env,
        cwd: projectRoot,
      });

      finetuneState.process = proc;
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
