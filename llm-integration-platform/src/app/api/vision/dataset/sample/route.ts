import { NextRequest } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import { getUserFromRequest } from '@/lib/auth';
import { SAMPLE_VISION_DATASETS } from '@/lib/constants';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const projectRoot = process.cwd();

  try {
    const body = await req.json();
    const { id } = body as { id: string };

    const sample = SAMPLE_VISION_DATASETS.find(s => s.id === id);
    if (!sample) {
      return new Response(JSON.stringify({ error: 'Unknown sample dataset' }), { status: 400 });
    }

    const uploadDir = path.resolve(projectRoot, 'output', userId, 'vision_datasets', 'uploads');
    const extractDir = path.resolve(projectRoot, 'output', userId, 'vision_datasets', 'extracted', sample.id);
    const zipPath = path.join(uploadDir, `${sample.id}.zip`);

    fs.mkdirSync(uploadDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });

    const scriptPath = path.join(projectRoot, 'scripts', 'vision_dataset_prepare.py');
    const venvDir = path.join(projectRoot, 'venvs', 'vision');
    const pythonBin = path.join(venvDir, 'bin', 'python3');
    const outputDir = path.resolve(projectRoot, 'output', userId, 'vision_datasets', 'prepared', sample.id);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        function send(event: string, data: Record<string, unknown>) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            closed = true;
          }
        }

        try {
          // Step 1: Download ZIP if not already cached
          if (!fs.existsSync(zipPath)) {
            send('progress', { message: `Downloading ${sample.name} dataset...`, progress: 0.1 });

            const resp = await fetch(sample.url);
            if (!resp.ok) {
              send('error', { message: `Download failed: HTTP ${resp.status}` });
              if (!closed) { closed = true; controller.close(); }
              return;
            }

            const arrayBuf = await resp.arrayBuffer();
            fs.writeFileSync(zipPath, Buffer.from(arrayBuf));
            send('progress', { message: `Downloaded ${(arrayBuf.byteLength / 1024 / 1024).toFixed(1)} MB`, progress: 0.3 });
          } else {
            send('progress', { message: `Using cached ${sample.name} ZIP`, progress: 0.3 });
          }

          // Step 2: Extract ZIP
          send('progress', { message: 'Extracting dataset...', progress: 0.35 });

          await new Promise<void>((resolve, reject) => {
            const unzip = spawn('unzip', ['-o', zipPath, '-d', extractDir], { stdio: ['ignore', 'pipe', 'pipe'] });
            unzip.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(`Unzip failed with code ${code}`));
            });
            unzip.on('error', reject);
          });

          send('progress', { message: 'Extracted successfully', progress: 0.4 });

          // Step 3: Run prepare script
          if (!fs.existsSync(pythonBin)) {
            // Fall back to system python3
            send('info', { message: 'Vision venv not found, using system Python' });
          }

          const python = fs.existsSync(pythonBin) ? pythonBin : 'python3';
          const sitePackages = path.join(venvDir, 'lib', 'python3.10', 'site-packages');
          const pythonPath = fs.existsSync(sitePackages) ? sitePackages : '';

          const env = {
            ...process.env,
            PATH: `${path.join(venvDir, 'bin')}:${process.env.HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH}`,
            PYTHONPATH: pythonPath,
          };

          send('progress', { message: 'Preparing dataset structure...', progress: 0.5 });

          let proc: ChildProcess | null = null;
          await new Promise<void>((resolve, reject) => {
            proc = spawn(python, [
              scriptPath,
              '--input', extractDir,
              '--output', outputDir,
              '--name', sample.id,
            ], { env, cwd: projectRoot, stdio: ['ignore', 'pipe', 'pipe'] });

            let stderr = '';

            proc.stdout?.on('data', (chunk: Buffer) => {
              const lines = chunk.toString().split('\n').filter(Boolean);
              for (const line of lines) {
                try {
                  const data = JSON.parse(line);
                  if (data.type === 'complete') {
                    send('complete', { message: data.message || `${sample.name} ready`, yamlPath: data.yaml_path, ...data });
                  } else if (data.type === 'error') {
                    send('error', { message: data.message || 'Preparation failed' });
                  } else {
                    send('progress', { message: data.message || 'Processing...', progress: 0.5 + (data.progress || 0) * 0.4 });
                  }
                } catch {
                  send('log', { message: line });
                }
              }
            });

            proc.stderr?.on('data', (chunk: Buffer) => {
              stderr += chunk.toString();
            });

            proc.on('close', (code) => {
              if (code === 0) resolve();
              else reject(new Error(stderr.slice(-500) || `Prepare script failed with code ${code}`));
            });

            proc.on('error', reject);
          });

          send('done', {});
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          send('error', { message: msg.slice(0, 500) });
          send('done', {});
        }

        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
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
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Server error';
    return new Response(JSON.stringify({ error: message.slice(0, 500) }), { status: 500 });
  }
}
