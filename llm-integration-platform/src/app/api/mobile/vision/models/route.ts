import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function scanVisionDir(visionDir: string, models: Record<string, unknown>[]) {
  if (!fs.existsSync(visionDir)) return;

  const entries = fs.readdirSync(visionDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const metadataPath = path.join(visionDir, entry.name, 'metadata.json');
    if (!fs.existsSync(metadataPath)) continue;

    try {
      const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
      const dirFiles = fs.readdirSync(path.join(visionDir, entry.name));

      // Find exportable model files
      const modelFile = dirFiles.find(f =>
        f.endsWith('.tflite') || f.endsWith('.onnx') || f.endsWith('.engine') ||
        f.endsWith('.mlmodel') || f === 'model.xml' || f.endsWith('.param')
      );

      if (!modelFile) continue;

      const modelPath = path.join(visionDir, entry.name, modelFile);
      const stats = fs.statSync(modelPath);
      const sizeMB = Math.round(stats.size / (1024 * 1024));

      models.push({
        dirName: entry.name,
        modelFile,
        format: metadata.format || path.extname(modelFile).slice(1),
        task: metadata.task || 'detect',
        baseModel: metadata.model || 'unknown',
        precision: metadata.precision || 'fp32',
        imgSize: metadata.imgSize || 640,
        sizeMB,
        sizeBytes: stats.size,
        exportDate: metadata.exportDate || null,
        mobileCompatible: modelFile.endsWith('.tflite') || sizeMB < 200,
        downloadUrl: `/api/mobile/vision/download?dir=${encodeURIComponent(entry.name)}&file=${encodeURIComponent(modelFile)}`,
      });
    } catch {
      // skip invalid metadata
    }
  }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const models: Record<string, unknown>[] = [];

  // Scan user-specific vision dir
  const userVisionDir = path.resolve(process.cwd(), 'output', user.userId, 'vision');
  scanVisionDir(userVisionDir, models);

  // Only admins see legacy root-level vision models
  if (user.role === 'admin') {
    const rootVisionDir = path.resolve(process.cwd(), 'output', 'vision');
    const rootModels: Record<string, unknown>[] = [];
    scanVisionDir(rootVisionDir, rootModels);
    const userDirs = new Set(models.map(m => m.dirName as string));
    for (const m of rootModels) {
      if (!userDirs.has(m.dirName as string)) models.push(m);
    }
  }

  // Sort: TFLite first (most mobile-friendly), then by size ascending
  models.sort((a, b) => {
    const aIsTflite = (a.modelFile as string).endsWith('.tflite') ? 0 : 1;
    const bIsTflite = (b.modelFile as string).endsWith('.tflite') ? 0 : 1;
    if (aIsTflite !== bIsTflite) return aIsTflite - bIsTflite;
    return (a.sizeMB as number) - (b.sizeMB as number);
  });

  return NextResponse.json({ models });
}
