import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const datasetsDir = path.resolve(process.cwd(), 'output', userId, 'vision_datasets', 'prepared');
  const datasets: Record<string, unknown>[] = [];

  if (!fs.existsSync(datasetsDir)) {
    return NextResponse.json({ datasets: [] });
  }

  const entries = fs.readdirSync(datasetsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metadataPath = path.join(datasetsDir, entry.name, 'metadata.json');
    if (!fs.existsSync(metadataPath)) continue;

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      datasets.push(metadata);
    } catch {
      // skip invalid metadata
    }
  }

  datasets.sort((a, b) => {
    const dateA = (a.preparedAt as string) || '';
    const dateB = (b.preparedAt as string) || '';
    return dateB.localeCompare(dateA);
  });

  return NextResponse.json({ datasets });
}
