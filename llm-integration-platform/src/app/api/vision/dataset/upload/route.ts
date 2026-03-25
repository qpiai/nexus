import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import {
  safeFormData,
  sanitizeName,
  sanitizeErrorMessage,
  MAX_DATASET_ZIP_SIZE,
} from '@/lib/vision-validation';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const projectRoot = process.cwd();

  try {
    const formDataOrErr = await safeFormData(req);
    if (formDataOrErr instanceof Response) return formDataOrErr;
    const formData = formDataOrErr;

    const file = formData.get('file') as File | null;
    const rawName = (formData.get('name') as string) || 'dataset';

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file uploaded' }), { status: 400 });
    }

    if (file.size > MAX_DATASET_ZIP_SIZE) {
      return new Response(JSON.stringify({ error: 'File too large (max 2 GB)' }), { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (ext !== '.zip') {
      return new Response(JSON.stringify({ error: 'Only ZIP files are supported' }), { status: 400 });
    }

    const datasetName = sanitizeName(rawName);
    if (!datasetName) {
      return new Response(JSON.stringify({ error: 'Invalid dataset name' }), { status: 400 });
    }

    const uploadDir = path.resolve(projectRoot, 'output', userId, 'vision_datasets', 'uploads');
    const extractDir = path.resolve(projectRoot, 'output', userId, 'vision_datasets', 'extracted', datasetName);

    fs.mkdirSync(uploadDir, { recursive: true });
    fs.mkdirSync(extractDir, { recursive: true });

    // Save ZIP file
    const zipPath = path.join(uploadDir, `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`);
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(zipPath, buffer);

    try {
      // Zip Slip prevention: check for path traversal entries
      const listResult = await new Promise<string>((resolve, reject) => {
        const listProc = spawn('unzip', ['-l', zipPath]);
        let output = '';
        listProc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
        listProc.on('close', (code) => code === 0 ? resolve(output) : reject(new Error('Failed to list ZIP')));
        listProc.on('error', reject);
      });

      if (listResult.includes('..')) {
        // Check each entry more carefully
        const lines = listResult.split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          const entryPath = parts[parts.length - 1];
          if (entryPath && entryPath.includes('..')) {
            try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
            return new Response(JSON.stringify({ error: 'ZIP contains path traversal entries' }), { status: 400 });
          }
        }
      }

      // Extract ZIP
      return await new Promise<Response>((resolve) => {
        const proc = spawn('unzip', ['-o', '-q', zipPath, '-d', extractDir]);

        let stderr = '';
        proc.stderr.on('data', (chunk: Buffer) => {
          stderr += chunk.toString();
        });

        proc.on('close', (code) => {
          try { fs.unlinkSync(zipPath); } catch { /* ignore */ }

          if (code !== 0) {
            resolve(new Response(JSON.stringify({ error: `Failed to extract ZIP: ${sanitizeErrorMessage(stderr.trim() || `exit code ${code}`, projectRoot)}` }), { status: 500 }));
            return;
          }

          resolve(new Response(JSON.stringify({
            name: datasetName,
          }), {
            headers: { 'Content-Type': 'application/json' },
          }));
        });

        proc.on('error', (err) => {
          try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
          resolve(new Response(JSON.stringify({ error: sanitizeErrorMessage(err.message, projectRoot) }), { status: 500 }));
        });
      });
    } catch {
      try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
      return new Response(JSON.stringify({ error: 'Failed to process ZIP file' }), { status: 500 });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: sanitizeErrorMessage((err as Error).message, projectRoot) }), { status: 500 });
  }
}
