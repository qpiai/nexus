import { NextRequest } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  getVisionTrainState,
  resetVisionTrainState,
  pushVisionTrainLog,
  pushEpochMetrics,
} from '@/lib/vision-train-state';
import {
  safeJsonParse,
  validatePathUnderBase,
  clampNumeric,
  sanitizeErrorMessage,
} from '@/lib/vision-validation';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 600;

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const projectRoot = process.cwd();

  try {
    const bodyOrErr = await safeJsonParse(req);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const {
      model,
      dataset,
      optimizer = 'auto',
      augment = true,
      resume = false,
    } = body;

    if (!model || !dataset) {
      return new Response(JSON.stringify({ error: 'Missing model or dataset' }), { status: 400 });
    }

    // Validate dataset path is under output/
    try {
      validatePathUnderBase(dataset as string, path.resolve(projectRoot, 'output'));
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid dataset path' }), { status: 400 });
    }

    // Clamp all numeric params
    const epochs = clampNumeric(body.epochs, 1, 1000, 50);
    const batchSize = clampNumeric(body.batchSize, 1, 256, 16);
    const imgSize = clampNumeric(body.imgSize, 32, 2048, 640);
    const learningRate = clampNumeric(body.learningRate, 1e-6, 1, 0.01);
    const patience = clampNumeric(body.patience, 0, 1000, 10);
    const freeze = clampNumeric(body.freeze, 0, 100, 0);

    const visionTrainState = getVisionTrainState(userId);

    // Set running = true immediately to prevent race condition
    if (visionTrainState.running && visionTrainState.process && !visionTrainState.process.killed) {
      return new Response(JSON.stringify({ error: 'A vision training job is already running. Please wait or stop it.' }), { status: 409 });
    }

    resetVisionTrainState(userId);
    visionTrainState.running = true;
    visionTrainState.model = model as string;
    visionTrainState.dataset = dataset as string;
    visionTrainState.startTime = Date.now();

    const scriptPath = path.join(projectRoot, 'scripts', 'vision_train.py');
    const venvDir = path.join(projectRoot, 'venvs', 'vision');
    const pythonBin = path.join(venvDir, 'bin', 'python3');
    const trainProject = path.resolve(projectRoot, 'output', userId, 'vision_train');

    if (!fs.existsSync(pythonBin)) {
      visionTrainState.running = false;
      return new Response(JSON.stringify({ error: 'Vision venv not found' }), { status: 500 });
    }

    // Generate unique run name
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const modelBase = (model as string).replace('.pt', '');
    const runName = `${modelBase}_${timestamp}`;

    const sitePackages = path.join(venvDir, 'lib', 'python3.10', 'site-packages');
    const pythonPath = fs.existsSync(sitePackages) ? sitePackages : '';

    const env = {
      ...process.env,
      PATH: `${path.join(venvDir, 'bin')}:${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
      PYTHONPATH: pythonPath,
    };

    let proc: ChildProcess | null = null;

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
          pushVisionTrainLog(userId, {
            type: event,
            message: (data.message as string) || event,
            progress: data.progress as number | undefined,
          });
          if (data.progress !== undefined) {
            visionTrainState.progress = data.progress as number;
          }
        }

        function finish() {
          if (closed) return;
          closed = true;
          visionTrainState.running = false;
          visionTrainState.process = null;
          try {
            controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
            controller.close();
          } catch { /* already closed */ }
        }

        send('info', { model, epochs, batchSize, imgSize, runName });

        const args = [
          scriptPath,
          '--model', model as string,
          '--data', dataset as string,
          '--epochs', String(epochs),
          '--batch', String(batchSize),
          '--imgsz', String(imgSize),
          '--lr', String(learningRate),
          '--optimizer', optimizer as string,
          '--freeze', String(freeze),
          '--patience', String(patience),
          '--project', trainProject,
          '--run-name', runName,
        ];

        if (augment) args.push('--augment');
        else args.push('--no-augment');
        if (resume) args.push('--resume');

        proc = spawn(pythonBin, args, { env, cwd: projectRoot });
        visionTrainState.process = proc;

        let buffer = '';

        proc.stdout!.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);

              if (parsed.type === 'epoch') {
                send('epoch', parsed);
                pushEpochMetrics(userId, {
                  epoch: parsed.epoch,
                  totalEpochs: parsed.totalEpochs,
                  boxLoss: parsed.boxLoss || 0,
                  clsLoss: parsed.clsLoss || 0,
                  dflLoss: parsed.dflLoss || 0,
                  mAP50: 0,
                  mAP5095: 0,
                  precision: 0,
                  recall: 0,
                  learningRate: parsed.learningRate || 0,
                });
                visionTrainState.progress = parsed.progress || 0;
              } else if (parsed.type === 'val_metrics') {
                send('val_metrics', parsed);
                pushEpochMetrics(userId, {
                  epoch: parsed.epoch,
                  totalEpochs: parsed.totalEpochs,
                  boxLoss: 0,
                  clsLoss: 0,
                  dflLoss: 0,
                  mAP50: parsed.mAP50 || 0,
                  mAP5095: parsed.mAP5095 || 0,
                  precision: parsed.precision || 0,
                  recall: parsed.recall || 0,
                  learningRate: 0,
                });
              } else if (parsed.type === 'complete') {
                sendAndTrack('complete', parsed);
                visionTrainState.done = true;
                visionTrainState.finalResult = parsed;
                visionTrainState.runDir = parsed.runDir || null;
              } else if (parsed.type === 'error') {
                sendAndTrack('error', parsed);
                visionTrainState.error = parsed.message;
              } else {
                sendAndTrack(parsed.type, parsed);
              }
            } catch {
              send('log', { message: line });
            }
          }
        });

        proc.stderr!.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n');
          for (const text of lines) {
            const trimmed = text.trim();
            if (trimmed && !trimmed.startsWith('Downloading') && !trimmed.includes('%|')) {
              send('log', { message: sanitizeErrorMessage(trimmed, projectRoot) });
            }
          }
        });

        proc.on('close', (code) => {
          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer);
              sendAndTrack(parsed.type, parsed);
              if (parsed.type === 'complete') {
                visionTrainState.done = true;
                visionTrainState.finalResult = parsed;
              }
            } catch {
              send('log', { message: buffer });
            }
          }
          if (code !== 0 && code !== null && !visionTrainState.done) {
            sendAndTrack('error', { message: `Process exited with code ${code}` });
            visionTrainState.error = `Process exited with code ${code}`;
          }
          finish();
        });

        proc.on('error', (err) => {
          sendAndTrack('error', { message: sanitizeErrorMessage(err.message, projectRoot) });
          visionTrainState.error = sanitizeErrorMessage(err.message, projectRoot);
          finish();
        });
      },
      cancel() {
        if (proc && !proc.killed) {
          proc.kill('SIGTERM');
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (err) {
    getVisionTrainState(userId).running = false;
    return new Response(JSON.stringify({ error: sanitizeErrorMessage((err as Error).message, projectRoot) }), { status: 500 });
  }
}

// GET: Return current training status (for state restoration)
export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const state = getVisionTrainState(userId);

  return new Response(JSON.stringify({
    running: state.running,
    model: state.model,
    dataset: state.dataset,
    progress: state.progress,
    logs: state.logs,
    epochMetrics: state.epochMetrics,
    error: state.error,
    done: state.done,
    runDir: state.runDir,
    finalResult: state.finalResult,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
