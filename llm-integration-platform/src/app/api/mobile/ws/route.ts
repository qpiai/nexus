import { NextRequest, NextResponse } from 'next/server';
import { addDeviceMetrics, checkThresholds, DEFAULT_THRESHOLDS } from '@/lib/telemetry';
import type { MetricPoint } from '@/lib/telemetry';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// WebSocket is not natively supported in Next.js App Router API routes.
// This endpoint provides SSE-based communication as an alternative.

interface DeviceRegistration {
  id: string;
  userId: string;
  name: string;
  status: string;
  lastSeen: number;
  metrics?: {
    cpuUsage: number;
    memoryUsage: number;
    temperature: number;
    batteryLevel: number;
    tokensPerSec?: number;
    activeModel?: string;
    totalInferences?: number;
    totalTokens?: number;
    engineType?: string;
  };
  inferenceHistory?: Array<{
    timestamp: number;
    tokensPerSec: number;
    tokenCount: number;
    elapsed: number;
    memoryUsage: number;
    cpuUsage: number;
    model: string;
    engineType: string;
    inferenceMode: string;
  }>;
}

// Offline detection timeout (60 seconds)
const OFFLINE_TIMEOUT_MS = 60000;

// Global map of device SSE send functions for pushing events from other routes
type SSESendFn = (event: string, data: unknown) => void;
const g = globalThis as Record<string, unknown>;
if (!g.__nexus_device_sse) {
  g.__nexus_device_sse = new Map<string, SSESendFn>();
}
const deviceSSE = g.__nexus_device_sse as Map<string, SSESendFn>;

// Pending deployments queue for devices not currently connected via SSE
if (!g.__nexus_pending_deploys) {
  g.__nexus_pending_deploys = new Map<string, Array<{ model: string; url: string; sizeMB: number }>>();
}
const pendingDeploys = g.__nexus_pending_deploys as Map<string, Array<{ model: string; url: string; sizeMB: number }>>;

function checkDeviceOfflineStatus(deviceRegistry: Map<string, DeviceRegistration>) {
  const now = Date.now();
  deviceRegistry.forEach((device) => {
    if (device.status !== 'offline' && (now - device.lastSeen) > OFFLINE_TIMEOUT_MS) {
      device.status = 'offline';
    }
  });
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const deviceId = searchParams.get('deviceId');

  if (!deviceId) {
    return NextResponse.json(
      { error: 'Missing deviceId' },
      { status: 400 }
    );
  }

  const deviceRegistry = (globalThis as Record<string, unknown>).__nexus_devices as Map<string, DeviceRegistration> | undefined;

  if (!deviceRegistry || !deviceRegistry.has(deviceId)) {
    return NextResponse.json(
      { error: 'Device not registered' },
      { status: 404 }
    );
  }

  // Verify device belongs to user
  const device = deviceRegistry.get(deviceId)!;
  if (device.userId !== user.userId) {
    return NextResponse.json({ error: 'Device not found' }, { status: 404 });
  }

  // Check for offline devices
  checkDeviceOfflineStatus(deviceRegistry);

  // SSE stream for device communication
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

      // Update device last seen
      const dev = deviceRegistry!.get(deviceId);
      if (dev) {
        dev.lastSeen = Date.now();
        dev.status = 'online';
      }

      send('connected', { deviceId, timestamp: Date.now() });

      // Register send function so other routes can push events to this device
      deviceSSE.set(deviceId, send);

      // Drain pending deployments for this device
      const pending = pendingDeploys.get(deviceId);
      if (pending && pending.length > 0) {
        for (const deploy of pending) {
          send('deploy', deploy);
        }
        pendingDeploys.delete(deviceId);
      }

      // Send heartbeat every 30s and check offline status
      const heartbeat = setInterval(() => {
        if (closed) {
          clearInterval(heartbeat);
          deviceSSE.delete(deviceId);
          // Mark offline when heartbeat detects closed connection
          const d = deviceRegistry!.get(deviceId);
          if (d && d.status !== 'offline') {
            d.status = 'offline';
          }
          return;
        }

        // Check all devices for offline timeout
        checkDeviceOfflineStatus(deviceRegistry!);

        send('heartbeat', { timestamp: Date.now() });
      }, 30000);
    },
    cancel() {
      deviceSSE.delete(deviceId);
      // Mark device offline when SSE connection drops
      const dev = deviceRegistry?.get(deviceId);
      if (dev) {
        dev.status = 'offline';
      }
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

// POST endpoint for devices to send metrics/status updates
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
  const { deviceId, type, data } = body;

  if (!deviceId || !type) {
    return NextResponse.json(
      { error: 'Missing deviceId or type' },
      { status: 400 }
    );
  }

  const deviceRegistry = (globalThis as Record<string, unknown>).__nexus_devices as Map<string, DeviceRegistration> | undefined;

  if (!deviceRegistry || !deviceRegistry.has(deviceId)) {
    return NextResponse.json(
      { error: 'Device not registered' },
      { status: 404 }
    );
  }

  const device = deviceRegistry.get(deviceId)!;

  // Verify device belongs to user
  if (device.userId !== user.userId) {
    return NextResponse.json({ error: 'Device not found' }, { status: 404 });
  }

  device.lastSeen = Date.now();

  // Check offline status for all devices
  checkDeviceOfflineStatus(deviceRegistry);

  if (type === 'metrics_update' && data) {
    device.metrics = {
      cpuUsage: data.cpuUsage ?? 0,
      memoryUsage: data.memoryUsage ?? 0,
      temperature: data.temperature ?? 0,
      batteryLevel: data.batteryLevel ?? 0,
      tokensPerSec: data.tokensPerSec,
      activeModel: data.activeModel,
      totalInferences: data.totalInferences,
      totalTokens: data.totalTokens,
      engineType: data.engineType,
    };

    // Store metrics in per-device history
    const metricPoint: MetricPoint = {
      timestamp: Date.now(),
      deploymentId: deviceId,
      tokensPerSec: data.tokensPerSec ?? 0,
      latencyMs: data.latencyMs ?? 0,
      cpuUsage: data.cpuUsage ?? 0,
      memoryUsage: data.memoryUsage ?? 0,
      gpuUsage: data.gpuUsage ?? 0,
      gpuTemp: data.temperature ?? 0,
      powerDraw: data.powerDraw ?? 0,
      requestsPerMin: data.requestsPerMin ?? 0,
    };
    addDeviceMetrics(deviceId, metricPoint);

    // Check thresholds and push alert via SSE if needed
    const alerts = checkThresholds(metricPoint, DEFAULT_THRESHOLDS, deviceId);
    if (alerts.length > 0) {
      const sendFn = deviceSSE.get(deviceId);
      if (sendFn) {
        for (const alert of alerts) {
          sendFn('alert', alert);
        }
      }
    }

    return NextResponse.json({ ok: true, alerts });
  } else if (type === 'inference_metrics' && data) {
    // Per-inference metrics from ChatActivity after each completion
    if (!device.inferenceHistory) {
      device.inferenceHistory = [];
    }
    device.inferenceHistory.push({
      timestamp: data.timestamp ?? Date.now(),
      tokensPerSec: data.tokensPerSec ?? 0,
      tokenCount: data.tokenCount ?? 0,
      elapsed: data.elapsed ?? 0,
      memoryUsage: data.memoryUsage ?? 0,
      cpuUsage: data.cpuUsage ?? 0,
      model: data.activeModel ?? '',
      engineType: data.engineType ?? 'unknown',
      inferenceMode: data.inferenceMode ?? 'unknown',
    });
    // Keep last 50 inference records per device
    if (device.inferenceHistory.length > 50) {
      device.inferenceHistory = device.inferenceHistory.slice(-50);
    }

    // Update device metrics with latest inference data
    device.metrics = {
      ...device.metrics,
      cpuUsage: data.cpuUsage ?? device.metrics?.cpuUsage ?? 0,
      memoryUsage: data.memoryUsage ?? device.metrics?.memoryUsage ?? 0,
      temperature: device.metrics?.temperature ?? 0,
      batteryLevel: data.batteryLevel ?? device.metrics?.batteryLevel ?? 0,
      tokensPerSec: data.tokensPerSec,
      activeModel: data.activeModel,
      engineType: data.engineType,
    };

    // Also store as a MetricPoint for the telemetry system
    const metricPoint: MetricPoint = {
      timestamp: Date.now(),
      deploymentId: deviceId,
      tokensPerSec: data.tokensPerSec ?? 0,
      latencyMs: (data.elapsed ?? 0) * 1000,
      cpuUsage: data.cpuUsage ?? 0,
      memoryUsage: data.memoryUsage ?? 0,
      gpuUsage: 0,
      gpuTemp: 0,
      powerDraw: 0,
      requestsPerMin: 0,
    };
    addDeviceMetrics(deviceId, metricPoint);

    return NextResponse.json({ ok: true });
  } else if (type === 'status_change' && data?.status) {
    device.status = data.status;
  }

  return NextResponse.json({ ok: true });
}
