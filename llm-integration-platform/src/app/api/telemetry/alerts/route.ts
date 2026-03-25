import { NextRequest, NextResponse } from 'next/server';
import { getAlerts } from '@/lib/telemetry';
import type { AlertSeverity } from '@/lib/telemetry';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const minutes = parseInt(searchParams.get('minutes') || '30');
  const severity = searchParams.get('severity') as AlertSeverity | null;
  const deviceId = searchParams.get('deviceId');

  let alerts = getAlerts(minutes);

  // Scope alerts to user's deployments and devices
  const deployments = (globalThis as Record<string, unknown>).__nexus_deployments as Map<string, { id: string; userId: string }> | undefined;
  const userDeploymentIds = new Set<string>();
  if (deployments) {
    Array.from(deployments.entries()).forEach(([id, dep]) => {
      if (dep.userId === user.userId) userDeploymentIds.add(id);
    });
  }
  // Include user's devices
  const deviceRegistry = (globalThis as Record<string, unknown>).__nexus_devices as Map<string, { userId: string }> | undefined;
  if (deviceRegistry) {
    Array.from(deviceRegistry.entries()).forEach(([id, dev]) => {
      if (dev.userId === user.userId) userDeploymentIds.add(id);
    });
  }
  userDeploymentIds.add('system');

  alerts = alerts.filter(a => userDeploymentIds.has(a.deviceId));

  // Filter by severity if specified
  if (severity && (severity === 'warning' || severity === 'critical')) {
    alerts = alerts.filter(a => a.severity === severity);
  }

  // Filter by deviceId if specified
  if (deviceId) {
    if (!userDeploymentIds.has(deviceId)) {
      return NextResponse.json({ alerts: [], total: 0 });
    }
    alerts = alerts.filter(a => a.deviceId === deviceId);
  }

  // Sort by timestamp descending (most recent first)
  alerts.sort((a, b) => b.timestamp - a.timestamp);

  return NextResponse.json({
    alerts,
    total: alerts.length,
  });
}
