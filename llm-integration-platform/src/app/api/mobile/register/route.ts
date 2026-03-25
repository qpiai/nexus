import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getUserFromRequest, createDeviceToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface DeviceRegistration {
  id: string;
  userId: string;
  name: string;
  platform: string;
  hardware: {
    cpuModel: string;
    cpuCores: number;
    ramGB: number;
    storageGB: number;
    gpuModel?: string;
    gpuMemoryMB?: number;
  };
  status: 'online' | 'offline' | 'busy';
  registeredAt: number;
  lastSeen: number;
  deployedModels: string[];
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

// Global device registry
const deviceRegistry: Map<string, DeviceRegistration> = (
  (globalThis as Record<string, unknown>).__nexus_devices as Map<string, DeviceRegistration>
) || new Map();
(globalThis as Record<string, unknown>).__nexus_devices = deviceRegistry;

// Build a fingerprint from device hardware to detect the same physical device
function deviceFingerprint(name: string, platform: string, hw: { cpuModel?: string; cpuCores?: number; ramGB?: number }): string {
  return `${name}|${platform}|${hw.cpuModel || ''}|${hw.cpuCores || 0}|${hw.ramGB || 0}`;
}

function findByFingerprint(name: string, platform: string, hw: { cpuModel?: string; cpuCores?: number; ramGB?: number }, userId: string): DeviceRegistration | undefined {
  const fp = deviceFingerprint(name, platform, hw);
  for (const device of Array.from(deviceRegistry.values())) {
    if (device.userId === userId && deviceFingerprint(device.name, device.platform, device.hardware) === fp) {
      return device;
    }
  }
  return undefined;
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized — scan QR code to connect' }, { status: 401 });
  }

  // Accept both pairing tokens and device tokens
  if (user.type !== 'device_pairing' && user.type !== 'device' && user.type !== 'user') {
    return NextResponse.json({ error: 'Invalid token type' }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const { name, platform, hardware, deviceId } = body;

  if (!name || !platform || !hardware) {
    return NextResponse.json(
      { error: 'Missing name, platform, or hardware specs' },
      { status: 400 }
    );
  }

  // 1) If client sent a saved deviceId and it still exists, reuse it
  let existing = deviceId ? deviceRegistry.get(deviceId) : undefined;

  // Verify device belongs to this user
  if (existing && existing.userId !== user.userId) {
    return NextResponse.json({ error: 'Device belongs to another user' }, { status: 403 });
  }

  // 2) Fallback: match by hardware fingerprint (same physical device, same user)
  if (!existing) {
    existing = findByFingerprint(name, platform, hardware, user.userId);
  }

  if (existing) {
    // Update the existing device entry — always bind to authenticated user
    existing.userId = user.userId;
    existing.name = name;
    existing.platform = platform;
    existing.hardware = hardware;
    existing.status = 'online';
    existing.lastSeen = Date.now();

    // Generate a device token for ongoing auth
    const deviceToken = await createDeviceToken(user.userId, existing.id);

    return NextResponse.json({
      id: existing.id,
      token: deviceToken,
      message: `Device ${name} reconnected`,
      wsEndpoint: `/api/mobile/ws?deviceId=${existing.id}`,
    });
  }

  // 3) Brand-new device
  const id = randomUUID().replace(/-/g, '').slice(0, 12);
  const device: DeviceRegistration = {
    id,
    userId: user.userId,
    name,
    platform,
    hardware,
    status: 'online',
    registeredAt: Date.now(),
    lastSeen: Date.now(),
    deployedModels: [],
  };

  deviceRegistry.set(id, device);

  // Generate a long-lived device token
  const deviceToken = await createDeviceToken(user.userId, id);

  return NextResponse.json({
    id: device.id,
    token: deviceToken,
    message: `Device ${name} registered to ${user.email || user.userId}`,
    wsEndpoint: `/api/mobile/ws?deviceId=${id}`,
  });
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Check offline status before returning
  const now = Date.now();
  const OFFLINE_TIMEOUT_MS = 60000; // 60 seconds
  deviceRegistry.forEach((device) => {
    if (device.status !== 'offline' && (now - device.lastSeen) > OFFLINE_TIMEOUT_MS) {
      device.status = 'offline';
    }
  });

  // STRICT: Only show user's own devices
  const devices = Array.from(deviceRegistry.values())
    .filter(d => d.userId === user.userId)
    .sort((a, b) => b.lastSeen - a.lastSeen);

  return NextResponse.json({ devices });
}
