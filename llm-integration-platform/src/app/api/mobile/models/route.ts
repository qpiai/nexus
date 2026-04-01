import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// Recommended RAM for various model sizes (rough estimates in GB)
function estimateRequiredRAM(sizeMB: number): number {
  // Model needs ~1.2x its file size in RAM for inference
  const ramGB = Math.ceil((sizeMB * 1.2) / 1024);
  return Math.max(ramGB, 1);
}

function getQuantizationType(filename: string): string {
  const match = filename.match(/[qQ](\d+)_([A-Z_]+)/);
  if (match) return `Q${match[1]}_${match[2]}`;
  const match2 = filename.match(/[qQ](\d+)/);
  if (match2) return `Q${match2[1]}`;
  return 'unknown';
}

function scanModelsDir(outputDir: string, models: Array<{
  id: string;
  name: string;
  file: string;
  size_bytes: number;
  size_mb: number;
  quantization: string;
  method: string;
  download_url: string;
  recommended_ram_gb: number;
  mobile_compatible: boolean;
  is_vlm?: boolean;
}>) {
  if (!fs.existsSync(outputDir)) return;

  const entries = fs.readdirSync(outputDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('_work_') || entry.name === 'datasets') continue;
    // Skip user UUID directories
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name)) continue;

    // GGUF files (most compatible with llama.cpp)
    if (entry.isFile() && entry.name.endsWith('.gguf')) {
      const filePath = path.join(outputDir, entry.name);
      const stats = fs.statSync(filePath);
      const sizeBytes = stats.size;
      const sizeMB = Math.round(sizeBytes / (1024 * 1024));
      const quantization = getQuantizationType(entry.name);

      const baseName = entry.name.replace('.gguf', '');
      const parts = baseName.split('-');
      const lastPart = parts.pop() || '';
      const secondLast = parts[parts.length - 1];
      let displayName = baseName;
      if (secondLast && /^[qQ]\d/.test(secondLast)) {
        displayName = parts.slice(0, -1).join(' ') + ' ' + secondLast + '_' + lastPart;
      } else {
        displayName = parts.join(' ') + ' ' + lastPart;
      }

      const mobileCompatible = sizeMB < 4096;
      const id = baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-');

      models.push({
        id,
        name: displayName,
        file: entry.name,
        size_bytes: sizeBytes,
        size_mb: sizeMB,
        quantization,
        method: 'GGUF',
        download_url: `/api/quantization/download?file=${encodeURIComponent(entry.name)}`,
        recommended_ram_gb: estimateRequiredRAM(sizeMB),
        mobile_compatible: mobileCompatible,
      });
    } else if (entry.isDirectory() && entry.name.endsWith('-fp16')) {
      const dirPath = path.join(outputDir, entry.name);
      const configPath = path.join(dirPath, 'config.json');
      if (fs.existsSync(configPath)) {
        let totalSize = 0;
        const files = fs.readdirSync(dirPath);
        for (const f of files) {
          const fPath = path.join(dirPath, f);
          const stats = fs.statSync(fPath);
          if (stats.isFile()) totalSize += stats.size;
        }
        const sizeBytes = totalSize;
        const sizeMB = Math.round(sizeBytes / (1024 * 1024));
        const displayName = entry.name.replace(/-fp16$/, ' FP16').replace(/-/g, ' ');
        const id = entry.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

        let isVLM = false;
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          isVLM = !!(config.vision_config || config.visual_encoder || config.image_processor_type || config.vision_tower);
        } catch { /* ignore */ }

        models.push({
          id,
          name: displayName,
          file: entry.name,
          size_bytes: sizeBytes,
          size_mb: sizeMB,
          quantization: 'FP16',
          method: 'FP16',
          download_url: '',
          recommended_ram_gb: estimateRequiredRAM(sizeMB),
          mobile_compatible: false,
          is_vlm: isVLM,
        });
      }
    }
  }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const models: Array<{
    id: string;
    name: string;
    file: string;
    size_bytes: number;
    size_mb: number;
    quantization: string;
    method: string;
    download_url: string;
    recommended_ram_gb: number;
    mobile_compatible: boolean;
    is_vlm?: boolean;
  }> = [];

  // Scan user-specific output dir
  const userOutputDir = path.resolve(process.cwd(), 'output', user.userId);
  scanModelsDir(userOutputDir, models);

  // All authenticated users (admins, device tokens, regular users) can see
  // shared root-level models so mobile devices can discover and download them
  const rootOutputDir = path.resolve(process.cwd(), 'output');
  const rootModels: typeof models = [];
  scanModelsDir(rootOutputDir, rootModels);
  const userFiles = new Set(models.map(m => m.file));
  for (const m of rootModels) {
    if (!userFiles.has(m.file)) models.push(m);
  }

  // Sort: mobile-compatible first, then by size ascending
  models.sort((a, b) => {
    if (a.mobile_compatible !== b.mobile_compatible) {
      return a.mobile_compatible ? -1 : 1;
    }
    return a.size_mb - b.size_mb;
  });

  return NextResponse.json({ models });
}
