import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface ValidationResult {
  safe: boolean;
  checks: {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    value: string;
    threshold: string;
    margin: string;
  }[];
  recommendation: string;
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { model, target, deviceSpecs } = body;

  if (!model || !target) {
    return NextResponse.json(
      { error: 'Missing model or target' },
      { status: 400 }
    );
  }

  // User-scoped model path, with admin fallback to root
  const isAdmin = user.role === 'admin';
  const userOutputDir = path.resolve(process.cwd(), 'output', user.userId);
  const rootOutputDir = path.resolve(process.cwd(), 'output');
  let modelPath = path.join(userOutputDir, model);
  if (!fs.existsSync(modelPath) && isAdmin) {
    modelPath = path.join(rootOutputDir, model);
  }

  if (!fs.existsSync(modelPath)) {
    return NextResponse.json(
      { error: `Model not found: ${model}` },
      { status: 404 }
    );
  }

  // Calculate model size
  let modelSizeMB = 0;
  const stat = fs.statSync(modelPath);
  if (stat.isFile()) {
    modelSizeMB = Math.round(stat.size / (1024 * 1024));
  } else if (stat.isDirectory()) {
    const files = fs.readdirSync(modelPath);
    for (const f of files) {
      const fStat = fs.statSync(path.join(modelPath, f));
      if (fStat.isFile()) modelSizeMB += fStat.size;
    }
    modelSizeMB = Math.round(modelSizeMB / (1024 * 1024));
  }

  // Safety validation based on device compatibility
  const ramGB = deviceSpecs?.ramGB || (target === 'cloud' ? 64 : target === 'edge' ? 4 : 16);
  const storageGB = deviceSpecs?.storageGB || (target === 'cloud' ? 500 : target === 'edge' ? 32 : 256);
  const tdpWatts = deviceSpecs?.tdpWatts || (target === 'cloud' ? 300 : target === 'edge' ? 15 : 65);

  const modelSizeGB = modelSizeMB / 1024;
  const runtimeMemoryGB = modelSizeGB * 1.3; // ~30% overhead for KV cache + runtime
  const memoryMargin = ((ramGB - runtimeMemoryGB) / ramGB) * 100;
  const storageMargin = ((storageGB - modelSizeGB) / storageGB) * 100;

  // Thermal check: estimate power draw based on model size
  const estimatedPowerDraw = modelSizeGB * 8; // rough W per GB
  const thermalMargin = ((tdpWatts - estimatedPowerDraw) / tdpWatts) * 100;

  const checks: ValidationResult['checks'] = [
    {
      name: 'Memory Safety',
      status: memoryMargin > 20 ? 'pass' : memoryMargin > 5 ? 'warn' : 'fail',
      value: `${runtimeMemoryGB.toFixed(1)} GB required`,
      threshold: `${ramGB} GB available`,
      margin: `${memoryMargin.toFixed(0)}%`,
    },
    {
      name: 'Storage Capacity',
      status: storageMargin > 10 ? 'pass' : storageMargin > 2 ? 'warn' : 'fail',
      value: `${modelSizeGB.toFixed(1)} GB model`,
      threshold: `${storageGB} GB available`,
      margin: `${storageMargin.toFixed(0)}%`,
    },
    {
      name: 'Thermal Envelope',
      status: thermalMargin > 25 ? 'pass' : thermalMargin > 10 ? 'warn' : 'fail',
      value: `${estimatedPowerDraw.toFixed(0)}W estimated`,
      threshold: `${tdpWatts}W TDP`,
      margin: `${thermalMargin.toFixed(0)}%`,
    },
    {
      name: 'Deployment Target',
      status: 'pass',
      value: target,
      threshold: 'Supported',
      margin: 'N/A',
    },
  ];

  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');

  const result: ValidationResult = {
    safe: !hasFail,
    checks,
    recommendation: hasFail
      ? 'Deployment is NOT recommended. Model exceeds target hardware limits.'
      : hasWarn
      ? 'Deployment is possible with warnings. Monitor resource usage closely.'
      : 'All safety checks passed. Deployment is recommended.',
  };

  return NextResponse.json(result);
}
