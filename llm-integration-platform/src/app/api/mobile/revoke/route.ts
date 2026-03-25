import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface DeviceRegistration {
  id: string;
  userId: string;
  name: string;
  status: string;
}

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

  const { deviceId } = body;
  if (!deviceId) {
    return NextResponse.json({ error: 'Missing deviceId' }, { status: 400 });
  }

  const deviceRegistry = (globalThis as Record<string, unknown>).__nexus_devices as Map<string, DeviceRegistration> | undefined;
  if (!deviceRegistry) {
    return NextResponse.json({ error: 'Device not found' }, { status: 404 });
  }

  const device = deviceRegistry.get(deviceId);
  if (!device) {
    return NextResponse.json({ error: 'Device not found' }, { status: 404 });
  }

  // Only the device owner (or admin) can revoke
  if (device.userId !== user.userId && user.role !== 'admin') {
    return NextResponse.json({ error: 'Device not found' }, { status: 404 });
  }

  // Remove device from registry — its token will fail on next API call
  deviceRegistry.delete(deviceId);

  return NextResponse.json({
    message: `Device ${device.name || deviceId} revoked`,
    deviceId,
  });
}
