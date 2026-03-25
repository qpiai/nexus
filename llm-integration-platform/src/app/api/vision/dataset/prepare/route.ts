import { NextRequest } from 'next/server';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  safeJsonParse,
  sanitizeName,
  sanitizeErrorMessage,
} from '@/lib/vision-validation';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const projectRoot = process.cwd();

  try {
    const bodyOrErr = await safeJsonParse(req);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const rawName = body.name as string | undefined;
    if (!rawName) {
      return new Response(JSON.stringify({ error: 'Missing dataset name' }), { status: 400 });
    }

    const name = sanitizeName(rawName);
    if (!name) {
      return new Response(JSON.stringify({ error: 'Invalid dataset name' }), { status: 400 });
    }

    // Reconstruct path server-side from name only
    const extractedPath = path.resolve(projectRoot, 'output', userId, 'vision_datasets', 'extracted', name);

    if (!fs.existsSync(extractedPath)) {
      return new Response(JSON.stringify({ error: 'Extracted dataset not found' }), { status: 400 });
    }

    const scriptPath = path.join(projectRoot, 'scripts', 'vision_dataset_prepare.py');
    const venvDir = path.join(projectRoot, 'venvs', 'vision');
    const pythonBin = path.join(venvDir, 'bin', 'python3');
    const outputDir = path.resolve(projectRoot, 'output', userId, 'vision_datasets', 'prepared', name);

    if (!fs.existsSync(pythonBin)) {
      return new Response(JSON.stringify({ error: 'Vision venv not found' }), { status: 500 });
    }

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

        function finish() {
          if (closed) return;
          closed = true;
          try {
            controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
            controller.close();
          } catch { /* already closed */ }
        }

        proc = spawn(pythonBin, [
          scriptPath,
          '--input', extractedPath,
          '--output', outputDir,
          '--name', name,
        ], { env, cwd: projectRoot });

        let buffer = '';

        proc.stdout!.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const parsed = JSON.parse(line);
              send(parsed.type, parsed);
            } catch {
              send('log', { message: line });
            }
          }
        });

        proc.stderr!.on('data', (chunk: Buffer) => {
          const lines = chunk.toString().split('\n');
          for (const text of lines) {
            const trimmed = text.trim();
            if (trimmed) send('log', { message: sanitizeErrorMessage(trimmed, projectRoot) });
          }
        });

        proc.on('close', (code) => {
          if (buffer.trim()) {
            try {
              const parsed = JSON.parse(buffer);
              send(parsed.type, parsed);
            } catch {
              send('log', { message: buffer });
            }
          }
          if (code !== 0 && code !== null) {
            send('error', { message: `Process exited with code ${code}` });
          }
          finish();
        });

        proc.on('error', (err) => {
          send('error', { message: sanitizeErrorMessage(err.message, projectRoot) });
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
    return new Response(JSON.stringify({ error: sanitizeErrorMessage((err as Error).message, projectRoot) }), { status: 500 });
  }
}
