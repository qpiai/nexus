import { NextRequest } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import {
  validatePathUnderBase,
  clampNumeric,
  sanitizeErrorMessage,
} from '@/lib/vision-validation';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const PROCESS_TIMEOUT_MS = 120_000;

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const projectRoot = process.cwd();

  try {
    // Accept multipart form data with image file + model params
    const formData = await req.formData().catch(() => null);
    if (!formData) {
      return new Response(JSON.stringify({ error: 'Invalid form data' }), { status: 400 });
    }

    const imageFile = formData.get('image') as File | null;
    const modelDirName = formData.get('modelDirName') as string | null;
    const modelFile = formData.get('modelFile') as string | null;
    const task = (formData.get('task') as string) || 'detect';

    if (!imageFile || !modelDirName) {
      return new Response(JSON.stringify({ error: 'Missing image or modelDirName' }), { status: 400 });
    }

    // User-scoped vision model path
    const userOutputBase = path.resolve(projectRoot, 'output', user.userId);
    const userVisionBase = path.resolve(userOutputBase, 'vision');
    let modelDir = path.resolve(userVisionBase, modelDirName);

    try {
      validatePathUnderBase(modelDir, userVisionBase);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid model path' }), { status: 400 });
    }

    // If not found in user dir and user is admin, try root vision dir
    if (!fs.existsSync(modelDir) && user.role === 'admin') {
      const rootVisionBase = path.resolve(projectRoot, 'output', 'vision');
      modelDir = path.resolve(rootVisionBase, modelDirName);
      try {
        validatePathUnderBase(modelDir, rootVisionBase);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid model path' }), { status: 400 });
      }
    }

    let modelPath: string;
    if (modelFile) {
      modelPath = path.join(modelDir, modelFile);
      try {
        validatePathUnderBase(modelPath, modelDir);
      } catch {
        return new Response(JSON.stringify({ error: 'Invalid model file path' }), { status: 400 });
      }
    } else {
      modelPath = modelDir;
    }

    // Save uploaded image to temp location
    const uploadsDir = path.resolve(projectRoot, 'output', 'vision_uploads');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

    const timestamp = Date.now();
    const ext = imageFile.name.split('.').pop() || 'jpg';
    const tempImageName = `mobile_${timestamp}.${ext}`;
    const imagePath = path.join(uploadsDir, tempImageName);

    const imageBuffer = Buffer.from(await imageFile.arrayBuffer());
    fs.writeFileSync(imagePath, imageBuffer);

    const conf = clampNumeric(Number(formData.get('conf')) || 0.25, 0, 1, 0.25);
    const iou = clampNumeric(Number(formData.get('iou')) || 0.45, 0, 1, 0.45);

    const scriptPath = path.join(projectRoot, 'scripts', 'vision_infer.py');
    const venvDir = path.join(projectRoot, 'venvs', 'vision');
    const pythonBin = path.join(venvDir, 'bin', 'python3');

    if (!fs.existsSync(pythonBin)) {
      try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
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
        '--task', task,
        '--conf', String(conf),
        '--iou', String(iou),
      ], { env, cwd: projectRoot });

      const timeout = setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGTERM');
          setTimeout(() => { if (!proc.killed) proc.kill('SIGKILL'); }, 5000);
        }
      }, PROCESS_TIMEOUT_MS);

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        try { fs.unlinkSync(imagePath); } catch { /* ignore */ }

        if (code !== 0) {
          const errMsg = sanitizeErrorMessage(
            stderr.trim().split('\n').pop() || `Process exited with code ${code}`,
            projectRoot
          );
          resolve(new Response(JSON.stringify({ error: errMsg }), { status: 500 }));
          return;
        }

        const lines = stdout.trim().split('\n');
        let result = null;
        let error = null;

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'result') result = parsed;
            else if (parsed.type === 'error') error = parsed.message;
          } catch { /* skip non-JSON */ }
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
        try { fs.unlinkSync(imagePath); } catch { /* ignore */ }
        resolve(new Response(JSON.stringify({ error: sanitizeErrorMessage(err.message, projectRoot) }), { status: 500 }));
      });
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: sanitizeErrorMessage((err as Error).message, projectRoot) }), { status: 500 });
  }
}
