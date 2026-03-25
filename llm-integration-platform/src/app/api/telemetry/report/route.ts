import { NextRequest, NextResponse } from 'next/server';
import { checkThresholds, DEFAULT_THRESHOLDS } from '@/lib/telemetry';
import type { MetricPoint, Alert } from '@/lib/telemetry';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // Verify that the deployment belongs to this user
  if (body.deploymentId) {
    const deployments = (globalThis as Record<string, unknown>).__nexus_deployments as Map<string, { userId: string }> | undefined;
    const dep = deployments?.get(body.deploymentId);
    if (dep && dep.userId !== user.userId) {
      return NextResponse.json({ error: 'Deployment not found' }, { status: 404 });
    }
  }

  // Store latest inference metrics per deployment for the live stream
  const reportedMetrics = ((globalThis as Record<string, unknown>).__nexus_reported_metrics as Record<string, unknown>) || {};
  (globalThis as Record<string, unknown>).__nexus_reported_metrics = reportedMetrics;

  if (body.deploymentId && body.tokensPerSec !== undefined) {
    reportedMetrics[body.deploymentId] = {
      tokensPerSec: body.tokensPerSec,
      latencyMs: body.latencyMs ?? 0,
      requestsPerMin: body.requestsPerMin ?? 0,
    };
  }

  const { metrics } = body;

  if (!metrics || !Array.isArray(metrics)) {
    return NextResponse.json(
      { error: 'Missing metrics array' },
      { status: 400 }
    );
  }

  // Initialize store if needed
  if (!(globalThis as Record<string, unknown>).__nexus_metrics) {
    (globalThis as Record<string, unknown>).__nexus_metrics = [];
  }

  const store = (globalThis as Record<string, unknown>).__nexus_metrics as MetricPoint[];
  const allAlerts: Alert[] = [];

  for (const m of metrics) {
    const point: MetricPoint = {
      timestamp: m.timestamp || Date.now(),
      deploymentId: m.deploymentId || 'unknown',
      tokensPerSec: m.tokensPerSec || 0,
      latencyMs: m.latencyMs || 0,
      cpuUsage: m.cpuUsage || 0,
      memoryUsage: m.memoryUsage || 0,
      gpuUsage: m.gpuUsage || 0,
      gpuTemp: m.gpuTemp || 0,
      powerDraw: m.powerDraw || 0,
      requestsPerMin: m.requestsPerMin || 0,
    };

    store.push(point);

    // Check thresholds for each metric point
    const alerts = checkThresholds(point, DEFAULT_THRESHOLDS, point.deploymentId);
    allAlerts.push(...alerts);
  }

  // Trim to last 5000 points
  while (store.length > 5000) store.shift();

  return NextResponse.json({
    received: metrics.length,
    total: store.length,
    alerts: allAlerts,
  });
}
