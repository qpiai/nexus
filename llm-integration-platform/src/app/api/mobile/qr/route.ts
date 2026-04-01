import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, createPairingToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Generate a short-lived pairing token (5 min)
  const token = await createPairingToken({
    id: user.userId,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  // Determine the server's public URL
  const forwardedHost = req.headers.get('x-forwarded-host');
  const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
  const host = forwardedHost || req.headers.get('host') || 'localhost:6001';
  const proto = forwardedHost ? forwardedProto : (host.startsWith('localhost') ? 'http' : 'https');
  const serverUrl = `${proto}://${host}`;

  // Return JSON that the dashboard can render as a QR code
  const qrData = JSON.stringify({ url: serverUrl, token });

  return NextResponse.json({
    qrData,
    serverUrl,
    token,
    expiresIn: 300,
  });
}
