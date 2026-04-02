import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const GGUF_QUANT_MAP: Record<number, string> = {
  2: 'q2_K',
  3: 'q3_K_M',
  4: 'q4_K_M',
  5: 'q5_K_M',
  8: 'q8_0',
  16: 'f16',
};

/**
 * Predict the output filename for a given model+method+bits combo,
 * matching the naming conventions used by the Python quantization scripts.
 */
function predictOutputName(model: string, method: string, bits: number): string {
  const modelName = model.split('/').pop() || model;
  const methodUpper = method.toUpperCase();

  if (methodUpper === 'GGUF' || methodUpper === 'FP16') {
    const quantType = GGUF_QUANT_MAP[bits] || `q${bits}_K_M`;
    return `${modelName}-${quantType}.gguf`;
  }
  if (methodUpper === 'AWQ') {
    return `${modelName}-awq-${bits}bit`;
  }
  if (methodUpper === 'GPTQ') {
    return `${modelName}-gptq-${bits}bit`;
  }
  // Fallback for other methods
  return `${modelName}-${methodUpper.toLowerCase()}-${bits}bit`;
}

export async function GET(req: NextRequest) {
  const model = req.nextUrl.searchParams.get('model');
  const method = req.nextUrl.searchParams.get('method');
  const bits = req.nextUrl.searchParams.get('bits');

  if (!model || !method || !bits) {
    return NextResponse.json({ error: 'Missing model, method, or bits' }, { status: 400 });
  }

  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';

  const outputDir = path.resolve(process.cwd(), 'output', userId);
  const predicted = predictOutputName(model, method, Number(bits));
  const fullPath = path.join(outputDir, predicted);

  // Security: ensure the resolved path is within the output directory
  if (!fullPath.startsWith(outputDir)) {
    return NextResponse.json({ error: 'Invalid parameters' }, { status: 400 });
  }

  if (!fs.existsSync(fullPath)) {
    return NextResponse.json({ exists: false });
  }

  const stat = fs.statSync(fullPath);
  const isDir = stat.isDirectory();

  // For directories (AWQ/GPTQ), sum up file sizes inside
  let sizeMB: number;
  if (isDir) {
    let totalBytes = 0;
    const entries = fs.readdirSync(fullPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        totalBytes += fs.statSync(path.join(fullPath, entry.name)).size;
      }
    }
    sizeMB = totalBytes / (1024 * 1024);
  } else {
    sizeMB = stat.size / (1024 * 1024);
  }

  return NextResponse.json({
    exists: true,
    file: predicted,
    sizeMB: Math.round(sizeMB * 10) / 10,
  });
}
