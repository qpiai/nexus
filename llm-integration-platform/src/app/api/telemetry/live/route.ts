export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkThresholds, DEFAULT_THRESHOLDS } from '@/lib/telemetry';
import type { MetricPoint } from '@/lib/telemetry';
import { getRealSystemMetrics } from '@/lib/system-metrics';
import { getUserFromRequest } from '@/lib/auth';

// Global metrics store
const metricsStore: MetricPoint[] = (
  (globalThis as Record<string, unknown>).__nexus_metrics as MetricPoint[]
) || [];
(globalThis as Record<string, unknown>).__nexus_metrics = metricsStore;

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = user.userId;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;

      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          closed = true;
        }
      }

      // Get active deployments — filter to user's deployments only
      const deployments = (globalThis as Record<string, unknown>).__nexus_deployments as Map<string, { id: string; userId: string; status: string; model: string }> | undefined;

      send('metrics', { type: 'connected', timestamp: Date.now() });

      const interval = setInterval(async () => {
        if (closed) {
          clearInterval(interval);
          return;
        }

        // Collect real system metrics
        const real = await getRealSystemMetrics();

        const runningDeps = deployments
          ? Array.from(deployments.values()).filter(d => d.status === 'running' && d.userId === userId)
          : [];

        // Get latest inference metrics from the report store
        const reportedMetrics = (globalThis as Record<string, unknown>).__nexus_reported_metrics as Record<string, { tokensPerSec: number; latencyMs: number; requestsPerMin: number }> | undefined;

        for (const dep of runningDeps) {
          const inferenceStats = reportedMetrics?.[dep.id];

          const point: MetricPoint = {
            timestamp: Date.now(),
            deploymentId: dep.id,
            tokensPerSec: inferenceStats?.tokensPerSec ?? 0,
            latencyMs: inferenceStats?.latencyMs ?? 0,
            cpuUsage: real.cpuUsage,
            memoryUsage: real.memoryUsage,
            gpuUsage: real.gpuUsage,
            gpuTemp: real.gpuTemp,
            powerDraw: real.powerDraw,
            requestsPerMin: inferenceStats?.requestsPerMin ?? 0,
          };

          metricsStore.push(point);
          if (metricsStore.length > 1000) metricsStore.shift();
          send('metrics', point);

          const alerts = checkThresholds(point, DEFAULT_THRESHOLDS, dep.id);
          for (const alert of alerts) {
            send('alert', alert);
          }
          if (alerts.length > 0) {
            send('alerts', { alerts, count: alerts.length });
          }
        }

        // System-level metrics when no user deployments running
        if (runningDeps.length === 0) {
          const systemPoint: MetricPoint = {
            timestamp: Date.now(),
            deploymentId: 'system',
            tokensPerSec: 0,
            latencyMs: 0,
            cpuUsage: real.cpuUsage,
            memoryUsage: real.memoryUsage,
            gpuUsage: real.gpuUsage,
            gpuTemp: real.gpuTemp,
            powerDraw: real.powerDraw,
            requestsPerMin: 0,
          };

          send('metrics', systemPoint);

          const alerts = checkThresholds(systemPoint, DEFAULT_THRESHOLDS, 'system');
          for (const alert of alerts) {
            send('alert', alert);
          }
          if (alerts.length > 0) {
            send('alerts', { alerts, count: alerts.length });
          }
        }
      }, 2000);

      // Cleanup after 5 minutes max
      setTimeout(() => {
        clearInterval(interval);
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* */ }
        }
      }, 300000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
