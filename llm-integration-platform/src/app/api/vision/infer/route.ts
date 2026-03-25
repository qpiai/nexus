import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  safeJsonParse,
  validatePathUnderBase,
  clampNumeric,
  sanitizeErrorMessage,
} from '@/lib/vision-validation';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PROCESS_TIMEOUT_MS = 120_000; // 2 minutes

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const projectRoot = process.cwd();

  try {
    const bodyOrErr = await safeJsonParse(req);
    if (bodyOrErr instanceof Response) return bodyOrErr;
    const body = bodyOrErr;

    const {
      imageFilename,
      modelDirName,
      modelFile,
      task = 'detect',
    } = body;

    if (!imageFilename || !modelDirName) {
      return new Response(JSON.stringify({ error: 'Missing imageFilename or modelDirName' }), { status: 400 });
    }

    // Reconstruct and validate paths server-side
    const userOutputBase = path.resolve(projectRoot, 'output', userId);

    const imagePath = path.resolve(userOutputBase, 'vision_uploads', imageFilename as string);
    try {
      validatePathUnderBase(imagePath, path.resolve(userOutputBase, 'vision_uploads'));
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid image path' }), { status: 400 });
    }

    let modelPath: string;
    const modelDir = path.resolve(userOutputBase, 'vision', modelDirName as string);
    try {
      validatePathUnderBase(modelDir, path.resolve(userOutputBase, 'vision'));
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid model path' }), { status: 400 });
    }

    if (modelFile) {
      modelPath = path.join(modelDir, modelFile as string);
      try {
        validatePathUnderBase(modelPath, modelDir);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid model file path' }), { status: 400 });
      }
    } else {
      modelPath = modelDir;
    }

    const conf = clampNumeric(body.conf, 0, 1, 0.25);
    const iou = clampNumeric(body.iou, 0, 1, 0.45);

    const scriptPath = path.join(projectRoot, 'scripts', 'vision_infer.py');
    const venvDir = path.join(projectRoot, 'venvs', 'vision');
    const pythonBin = path.join(venvDir, 'bin', 'python3');

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

    return new Promise<Response>((resolve) => {
      const proc = spawn(pythonBin, [
        scriptPath,
        '--model', modelPath,
        '--image', imagePath,
        '--task', task as string,
        '--conf', String(conf),
        '--iou', String(iou),
      ], {
        env,
        cwd: projectRoot,
      });

      // Process timeout
      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGTERM');
          setTimeout(() => {
            if (!proc.killed) proc.kill('SIGKILL');
          }, 5000);
        }
      }, PROCESS_TIMEOUT_MS);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);

        if (code !== 0) {
          const errMsg = sanitizeErrorMessage(
            stderr.trim().split('\n').pop() || `Process exited with code ${code}`,
            projectRoot
          );
          resolve(new Response(JSON.stringify({ error: errMsg }), { status: 500 }));
          return;
        }

        // Parse JSON lines from stdout
        const lines = stdout.trim().split('\n');
        let result = null;
        let error = null;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'result') {
              result = parsed;
            } else if (parsed.type === 'error') {
              error = parsed.message;
            }
          } catch {
            // skip non-JSON lines
          }
        }

        if (error) {
          resolve(new Response(JSON.stringify({ error: sanitizeErrorMessage(error, projectRoot) }), { status: 500 }));
        } else if (result) {
          resolve(new Response(JSON.stringify(result), {
            headers: { 'Content-Type': 'application/json' },
          }));
        } else {
          resolve(new Response(JSON.stringify({ error: 'No result from inference script' }), { status: 500 }));
        }
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve(new Response(JSON.stringify({ error: sanitizeErrorMessage(err.message, projectRoot) }), { status: 500 }));
      });
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: sanitizeErrorMessage((err as Error).message, projectRoot) }), { status: 500 });
  }
}
