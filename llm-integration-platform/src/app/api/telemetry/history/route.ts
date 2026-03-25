import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface MetricPoint {
  timestamp: number;
  deploymentId: string;
  tokensPerSec: number;
  latencyMs: number;
  cpuUsage: number;
  memoryUsage: number;
  gpuUsage: number;
  gpuTemp: number;
  powerDraw: number;
  requestsPerMin: number;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const deploymentId = searchParams.get('deploymentId');
  const minutes = parseInt(searchParams.get('minutes') || '30');

  const metricsStore = (globalThis as Record<string, unknown>).__nexus_metrics as MetricPoint[] | undefined;

  if (!metricsStore || metricsStore.length === 0) {
    return NextResponse.json({ metrics: [] });
  }

  // Get user's deployment IDs for filtering
  const deployments = (globalThis as Record<string, unknown>).__nexus_deployments as Map<string, { id: string; userId: string }> | undefined;
  const userDeploymentIds = new Set<string>();
  if (deployments) {
    Array.from(deployments.entries()).forEach(([id, dep]) => {
      if (dep.userId === user.userId) userDeploymentIds.add(id);
    });
  }
  // Always include 'system' metrics
  userDeploymentIds.add('system');

  const cutoff = Date.now() - minutes * 60 * 1000;
  let filtered = metricsStore.filter(m => m.timestamp >= cutoff && userDeploymentIds.has(m.deploymentId));

  if (deploymentId) {
    // Verify the requested deployment belongs to this user
    if (!userDeploymentIds.has(deploymentId)) {
      return NextResponse.json({ metrics: [] });
    }
    filtered = filtered.filter(m => m.deploymentId === deploymentId);
  }

  return NextResponse.json({ metrics: filtered });
}
