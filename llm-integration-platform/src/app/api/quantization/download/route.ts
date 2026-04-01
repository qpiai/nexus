import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file');

  if (!file) {
    return NextResponse.json({ error: 'Missing file parameter' }, { status: 400 });
  }

  const user = await getUserFromRequest(req);
  const userId = user?.userId;

  // Security: only allow basename (no path traversal)
  const safeName = path.basename(file);
  const rootOutputDir = path.resolve(process.cwd(), 'output');

  // Check user-specific dir first, then fall back to root output dir.
  // This endpoint is public (in middleware PUBLIC_PATHS), so all users
  // including unauthenticated and device-token users can download shared models.
  let outputDir = rootOutputDir;
  let filePath = '';

  if (userId) {
    const userOutputDir = path.resolve(process.cwd(), 'output', userId);
    filePath = path.join(userOutputDir, safeName);
    if (fs.existsSync(filePath)) {
      outputDir = userOutputDir;
    } else {
      filePath = path.join(rootOutputDir, safeName);
    }
  } else {
    filePath = path.join(rootOutputDir, safeName);
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({
      error: 'Model file not found',
      file: safeName,
      authenticated: !!user,
      hint: !user ? 'Login may be required to access this model' : `Model not found in user output directory`,
    }, { status: 404 });
  }

  const stat = fs.statSync(filePath);

  // If it's a directory (AWQ output), create a tar.gz stream
  if (stat.isDirectory()) {
    const tarStream = new ReadableStream({
      start(controller) {
        const tar = spawn('tar', ['czf', '-', '-C', outputDir, safeName]);

        tar.stdout.on('data', (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });

        tar.stderr.on('data', () => {
          // ignore tar warnings
        });

        tar.on('close', (code) => {
          if (code !== 0) {
            controller.error(new Error(`tar exited with code ${code}`));
          } else {
            controller.close();
          }
        });

        tar.on('error', (err) => {
          controller.error(err);
        });
      },
    });

    return new Response(tarStream, {
      headers: {
        'Content-Type': 'application/gzip',
        'Content-Disposition': `attachment; filename="${safeName}.tar.gz"`,
      },
    });
  }

  // Regular file (GGUF output)
  const stream = fs.createReadStream(filePath);
  const webStream = new ReadableStream({
    start(controller) {
      stream.on('data', (chunk) => controller.enqueue(chunk));
      stream.on('end', () => controller.close());
      stream.on('error', (err) => controller.error(err));
    },
  });

  return new Response(webStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeName}"`,
      'Content-Length': String(stat.size),
    },
  });
}
