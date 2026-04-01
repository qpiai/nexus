import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';
import type { AlpacaSample, ShareGPTSample } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { samples, format, name } = body as {
    samples: (AlpacaSample | ShareGPTSample)[];
    format: 'alpaca' | 'sharegpt';
    name?: string;
  };

  if (!samples || !Array.isArray(samples) || samples.length === 0) {
    return NextResponse.json({ error: 'No samples provided' }, { status: 400 });
  }

  if (!format || !['alpaca', 'sharegpt'].includes(format)) {
    return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
  }

  const userId = user.userId;
  const datasetsDir = path.resolve(process.cwd(), 'output', userId, 'datasets');
  fs.mkdirSync(datasetsDir, { recursive: true });

  // Generate safe filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const baseName = name
    ? name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 50)
    : `synthetic_${format}_${samples.length}`;
  const fileName = `${baseName}_${timestamp}.json`;
  const filePath = path.join(datasetsDir, fileName);

  // Write as JSON array
  fs.writeFileSync(filePath, JSON.stringify(samples, null, 2), 'utf-8');

  return NextResponse.json({
    name: fileName.replace(/\.json$/, ''),
    path: filePath,
    format,
    samples: samples.length,
  });
}
