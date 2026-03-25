import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface FinetuneModelInfo {
  name: string;
  path: string;
  baseModel: string;
  method: string;
  createdAt: number;
  sizeMB: number;
  hasAdapter: boolean;
  hasMerged: boolean;
}

function scanFinetuneDir(outputDir: string, models: FinetuneModelInfo[]) {
  if (!fs.existsSync(outputDir)) return;

  const entries = fs.readdirSync(outputDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    const dirPath = path.join(outputDir, entry.name);
    const stats = fs.statSync(dirPath);

    // Calculate directory size
    let totalSize = 0;
    const walkDir = (dir: string) => {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const fp = path.join(dir, f);
          const s = fs.statSync(fp);
          if (s.isFile()) totalSize += s.size;
          else if (s.isDirectory()) walkDir(fp);
        }
      } catch {
        // skip inaccessible dirs
      }
    };
    walkDir(dirPath);

    // Detect adapter vs merged
    const hasAdapter = fs.existsSync(path.join(dirPath, 'adapter_model.safetensors')) ||
                       fs.existsSync(path.join(dirPath, 'adapter_model.bin'));
    const hasMerged = fs.existsSync(path.join(dirPath + '_merged')) ||
                      (fs.existsSync(path.join(dirPath, 'model.safetensors')) && !hasAdapter);

    // Try to read training config for base model info
    let baseModel = 'unknown';
    let method = 'qlora';
    const configPath = path.join(dirPath, 'train_config.yaml');
    if (fs.existsSync(configPath)) {
      try {
        const content = fs.readFileSync(configPath, 'utf-8');
        const modelMatch = content.match(/model_name_or_path:\s*(.+)/);
        if (modelMatch) baseModel = modelMatch[1].trim();
        const ftMatch = content.match(/finetuning_type:\s*(.+)/);
        const qbitMatch = content.match(/quantization_bit:\s*(\d+)/);
        if (ftMatch) {
          method = ftMatch[1].trim();
          if (method === 'lora' && qbitMatch) method = 'qlora';
        }
      } catch {
        // ignore
      }
    }

    const displayName = entry.name
      .replace(/_ft_\d+$/, '')
      .replace(/_merged$/, '')
      .replace(/-/g, ' ');

    models.push({
      name: displayName,
      path: dirPath,
      baseModel,
      method,
      createdAt: stats.mtimeMs,
      sizeMB: Math.round(totalSize / (1024 * 1024)),
      hasAdapter,
      hasMerged,
    });
  }
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const models: FinetuneModelInfo[] = [];

  // Scan user-specific finetune dir
  const userFinetuneDir = path.resolve(process.cwd(), 'output', user.userId, 'finetune');
  scanFinetuneDir(userFinetuneDir, models);

  // Only admins see legacy root-level finetune models
  if (user.role === 'admin') {
    const rootFinetuneDir = path.resolve(process.cwd(), 'output', 'finetune');
    const rootModels: FinetuneModelInfo[] = [];
    scanFinetuneDir(rootFinetuneDir, rootModels);
    const userNames = new Set(models.map(m => m.name));
    for (const m of rootModels) {
      if (!userNames.has(m.name)) models.push(m);
    }
  }

  // Sort by creation date, newest first
  models.sort((a, b) => b.createdAt - a.createdAt);

  return NextResponse.json({ models });
}
