import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { deviceId, model } = body;

  if (!deviceId || !model) {
    return NextResponse.json(
      { error: 'Missing deviceId or model' },
      { status: 400 }
    );
  }

  // Verify device belongs to user
  const deviceRegistry = (globalThis as Record<string, unknown>).__nexus_devices as Map<string, { userId: string; deployedModels: string[] }> | undefined;
  if (!deviceRegistry?.has(deviceId)) {
    return NextResponse.json({ error: 'Device not registered' }, { status: 404 });
  }
  const device = deviceRegistry.get(deviceId)!;
  if (device.userId !== user.userId) {
    return NextResponse.json({ error: 'Device not found' }, { status: 404 });
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

  // Get model size
  const stat = fs.statSync(modelPath);
  let sizeMB = 0;
  if (stat.isFile()) {
    sizeMB = Math.round(stat.size / (1024 * 1024));
  } else {
    const files = fs.readdirSync(modelPath);
    for (const f of files) {
      const fStat = fs.statSync(path.join(modelPath, f));
      if (fStat.isFile()) sizeMB += fStat.size;
    }
    sizeMB = Math.round(sizeMB / (1024 * 1024));
  }

  // Update device registry
  if (!device.deployedModels.includes(model)) {
    device.deployedModels.push(model);
  }

  // Send deploy event to device via SSE, or queue if not connected
  type SSESendFn = (event: string, data: unknown) => void;
  const deviceSSE = (globalThis as Record<string, unknown>).__nexus_device_sse as Map<string, SSESendFn> | undefined;
  const deployPayload = {
    model,
    url: `/api/quantization/download?file=${encodeURIComponent(model)}`,
    sizeMB,
  };

  let delivered = false;
  if (deviceSSE?.has(deviceId)) {
    const send = deviceSSE.get(deviceId)!;
    send('deploy', deployPayload);
    delivered = true;
  } else {
    // Queue for delivery when device reconnects
    const pendingDeploys = (globalThis as Record<string, unknown>).__nexus_pending_deploys as Map<string, Array<{ model: string; url: string; sizeMB: number }>> | undefined;
    if (pendingDeploys) {
      const queue = pendingDeploys.get(deviceId) || [];
      queue.push(deployPayload);
      pendingDeploys.set(deviceId, queue);
    }
  }

  return NextResponse.json({
    message: delivered
      ? `Model ${model} push sent to device ${deviceId}`
      : `Model ${model} queued — device will receive it when it reconnects`,
    delivered,
    sizeMB,
    estimatedTransferTime: `${Math.ceil(sizeMB / 10)}s`,
  });
}
