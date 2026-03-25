import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { sanitizeName, validatePathUnderBase } from '@/lib/vision-validation';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const dirName = searchParams.get('dir');
  const fileName = searchParams.get('file');

  if (!dirName || !fileName) {
    return NextResponse.json({ error: 'Missing dir or file parameter' }, { status: 400 });
  }

  const safeDirName = sanitizeName(dirName);
  const safeFileName = sanitizeName(fileName);

  if (!safeDirName || !safeFileName) {
    return NextResponse.json({ error: 'Invalid dir or file name' }, { status: 400 });
  }

  // Try user-specific vision dir first
  const userVisionBase = path.resolve(process.cwd(), 'output', user.userId, 'vision');
  let filePath = path.resolve(userVisionBase, safeDirName, safeFileName);

  try {
    validatePathUnderBase(filePath, userVisionBase);
  } catch {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  // If not found in user dir and user is admin, try root vision dir
  if (!fs.existsSync(filePath) && user.role === 'admin') {
    const rootVisionBase = path.resolve(process.cwd(), 'output', 'vision');
    filePath = path.resolve(rootVisionBase, safeDirName, safeFileName);
    try {
      validatePathUnderBase(filePath, rootVisionBase);
    } catch {
      return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
    }
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Model file not found' }, { status: 404 });
  }

  const stats = fs.statSync(filePath);
  const stream = fs.createReadStream(filePath);

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFileName}"`,
      'Content-Length': String(stats.size),
    },
  });
}
