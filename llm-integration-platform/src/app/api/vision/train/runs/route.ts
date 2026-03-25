import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const trainDir = path.resolve(process.cwd(), 'output', userId, 'vision_train');
  const runs: Record<string, unknown>[] = [];

  if (!fs.existsSync(trainDir)) {
    return NextResponse.json({ runs: [] });
  }

  const entries = fs.readdirSync(trainDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metadataPath = path.join(trainDir, entry.name, 'train_metadata.json');
    if (!fs.existsSync(metadataPath)) continue;

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      runs.push({
        ...metadata,
        dirName: entry.name,
      });
    } catch {
      // skip invalid
    }
  }

  runs.sort((a, b) => {
    const dateA = (a.completedAt as string) || '';
    const dateB = (b.completedAt as string) || '';
    return dateB.localeCompare(dateA);
  });

  return NextResponse.json({ runs });
}
