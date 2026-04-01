import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface ModelInfo {
  name: string;
  file: string;
  method: 'GGUF' | 'AWQ' | 'GPTQ' | 'BitNet' | 'MLX' | 'Finetune' | 'FP16';
  sizeMB: number;
  isVLM?: boolean;
}

function scanOutputDir(outputDir: string, models: ModelInfo[]) {
  if (!fs.existsSync(outputDir)) return;

  const entries = fs.readdirSync(outputDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith('_work_') || entry.name === 'datasets') continue;
    // Skip user UUID directories to prevent data leaking between users
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name)) continue;

    if (entry.isFile() && entry.name.endsWith('.gguf')) {
      const filePath = path.join(outputDir, entry.name);
      const stats = fs.statSync(filePath);
      const sizeMB = Math.round(stats.size / (1024 * 1024));
      const baseName = entry.name.replace('.gguf', '');
      const parts = baseName.split('-');
      const quantPart = parts.pop() || '';
      const quantPart2 = parts[parts.length - 1];
      let displayName = baseName;
      if (quantPart2 && /^[qQ]\d/.test(quantPart2)) {
        displayName = parts.slice(0, -1).join('-') + ' ' + quantPart2 + '_' + quantPart;
      } else {
        displayName = parts.join('-') + ' ' + quantPart;
      }
      models.push({ name: displayName, file: entry.name, method: 'GGUF', sizeMB });
    } else if (entry.isDirectory() && entry.name.endsWith('-fp16')) {
      const dirPath = path.join(outputDir, entry.name);
      const configPath = path.join(dirPath, 'config.json');
      if (fs.existsSync(configPath)) {
        let totalSize = 0;
        for (const f of fs.readdirSync(dirPath)) {
          const stats = fs.statSync(path.join(dirPath, f));
          if (stats.isFile()) totalSize += stats.size;
        }
        let isVLM = false;
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
          isVLM = !!(config.vision_config || config.visual_encoder || config.image_processor_type || config.vision_tower);
        } catch { /* ignore */ }
        models.push({
          name: entry.name.replace(/-fp16$/, ' FP16').replace(/-/g, ' '),
          file: entry.name, method: 'FP16',
          sizeMB: Math.round(totalSize / (1024 * 1024)), isVLM,
        });
      }
    } else if (entry.isDirectory() && (entry.name.includes('-awq-') || entry.name.includes('-gptq-') || entry.name.includes('-bitnet-') || entry.name.includes('-mlx-'))) {
      const dirPath = path.join(outputDir, entry.name);
      let totalSize = 0;
      for (const f of fs.readdirSync(dirPath)) {
        const stats = fs.statSync(path.join(dirPath, f));
        if (stats.isFile()) totalSize += stats.size;
      }
      let method: 'AWQ' | 'GPTQ' | 'BitNet' | 'MLX' = 'AWQ';
      let displayName = entry.name;
      if (entry.name.includes('-mlx-')) { method = 'MLX'; displayName = entry.name.replace(/-mlx-/g, ' MLX ').replace(/-/g, ' '); }
      else if (entry.name.includes('-gptq-')) { method = 'GPTQ'; displayName = entry.name.replace(/-gptq-/g, ' GPTQ ').replace(/-/g, ' '); }
      else if (entry.name.includes('-bitnet-')) { method = 'BitNet'; displayName = entry.name.replace(/-bitnet-/g, ' BitNet ').replace(/-/g, ' '); }
      else { displayName = entry.name.replace(/-awq-/g, ' AWQ ').replace(/-/g, ' '); }
      models.push({ name: displayName, file: entry.name, method, sizeMB: Math.round(totalSize / (1024 * 1024)) });
    }
  }

  // Scan finetune subdirectory
  const finetuneDir = path.join(outputDir, 'finetune');
  if (fs.existsSync(finetuneDir)) {
    for (const ftEntry of fs.readdirSync(finetuneDir, { withFileTypes: true })) {
      if (!ftEntry.isDirectory()) continue;
      const ftPath = path.join(finetuneDir, ftEntry.name);
      const checkpoints = fs.readdirSync(ftPath, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('checkpoint-'))
        .sort((a, b) => (parseInt(b.name.split('-')[1]) || 0) - (parseInt(a.name.split('-')[1]) || 0));
      for (const cp of checkpoints) {
        const cpPath = path.join(ftPath, cp.name);
        const adapterConfig = path.join(cpPath, 'adapter_config.json');
        if (fs.existsSync(adapterConfig)) {
          let totalSize = 0;
          for (const f of fs.readdirSync(cpPath)) {
            const stats = fs.statSync(path.join(cpPath, f));
            if (stats.isFile()) totalSize += stats.size;
          }
          let baseModel = '';
          try { baseModel = JSON.parse(fs.readFileSync(adapterConfig, 'utf-8')).base_model_name_or_path?.split('/').pop() || ''; } catch { /* ignore */ }
          models.push({
            name: `${ftEntry.name} (${cp.name})${baseModel ? ` [${baseModel}]` : ''}`,
            file: `finetune/${ftEntry.name}/${cp.name}`, method: 'Finetune',
            sizeMB: Math.round(totalSize / (1024 * 1024)),
          });
          break;
        }
      }
    }
  }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId;
  const models: ModelInfo[] = [];

  // Scan user-specific output dir if authenticated
  if (userId) {
    const userOutputDir = path.resolve(process.cwd(), 'output', userId);
    scanOutputDir(userOutputDir, models);
  }

  // All users (including unauthenticated and device-token users) can see
  // root-level shared models. This endpoint is public per middleware.
  const rootOutputDir = path.resolve(process.cwd(), 'output');
  const rootModels: ModelInfo[] = [];
  scanOutputDir(rootOutputDir, rootModels);
  const userFiles = new Set(models.map(m => m.file));
  for (const m of rootModels) {
    if (!userFiles.has(m.file)) models.push(m);
  }

  // Sort by method then name
  models.sort((a, b) => {
    if (a.method !== b.method) return a.method.localeCompare(b.method);
    return a.name.localeCompare(b.name);
  });

  return NextResponse.json({ models });
}
