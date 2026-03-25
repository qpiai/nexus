import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const visionDir = path.resolve(process.cwd(), 'output', userId, 'vision');
  const models: Record<string, unknown>[] = [];

  if (!fs.existsSync(visionDir)) {
    return NextResponse.json({ models: [] });
  }

  const entries = fs.readdirSync(visionDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metadataPath = path.join(visionDir, entry.name, 'metadata.json');
    if (!fs.existsSync(metadataPath)) continue;

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      // Find the actual model file in the directory
      const dirFiles = fs.readdirSync(path.join(visionDir, entry.name));
      const modelFile = dirFiles.find(f =>
        f.endsWith('.onnx') || f.endsWith('.engine') || f.endsWith('.mlmodel') ||
        f.endsWith('.tflite') || f === 'model.xml' || f.endsWith('.param')
      );

      models.push({
        ...metadata,
        modelFile: modelFile || null,
        dirName: entry.name,
      });
    } catch {
      // skip invalid metadata
    }
  }

  models.sort((a, b) => {
    const dateA = (a.exportDate as string) || '';
    const dateB = (b.exportDate as string) || '';
    return dateB.localeCompare(dateA);
  });

  return NextResponse.json({ models });
}
