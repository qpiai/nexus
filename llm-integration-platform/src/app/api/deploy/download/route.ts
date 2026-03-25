import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const file = req.nextUrl.searchParams.get('file');

  if (!file) {
    return NextResponse.json({ error: 'Missing file parameter' }, { status: 400 });
  }

  // Prevent path traversal
  const sanitized = path.basename(file);
  if (sanitized !== file || file.includes('..')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  // User-scoped output dir, with admin fallback to root
  const isAdmin = user.role === 'admin';
  const userOutputDir = path.resolve(process.cwd(), 'output', user.userId);
  let filePath = path.join(userOutputDir, sanitized);

  if (!fs.existsSync(filePath) && isAdmin) {
    const rootOutputDir = path.resolve(process.cwd(), 'output');
    filePath = path.join(rootOutputDir, sanitized);
  }

  // Validate resolved path is under allowed directories
  const resolved = path.resolve(filePath);
  const userBase = path.resolve(process.cwd(), 'output', user.userId);
  const rootBase = path.resolve(process.cwd(), 'output');
  if (!resolved.startsWith(userBase) && !(isAdmin && resolved.startsWith(rootBase))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return NextResponse.json({ error: `File not found: ${sanitized}` }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);

  const readableStream = new ReadableStream({
    start(controller) {
      stream.on('data', (chunk: string | Buffer) => {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        controller.enqueue(new Uint8Array(buf));
      });
      stream.on('end', () => {
        controller.close();
      });
      stream.on('error', (err) => {
        controller.error(err);
      });
    },
    cancel() {
      stream.destroy();
    },
  });

  return new Response(readableStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size.toString(),
      'Content-Disposition': `attachment; filename="${sanitized}"`,
    },
  });
}
