import { NextRequest, NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { getUserFromRequest, createDevicePairingToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const pairingToken = await createDevicePairingToken(user.userId);

    // Derive server URL from headers (cloudflared sets x-forwarded-host)
    const forwardedHost = req.headers.get('x-forwarded-host');
    const forwardedProto = req.headers.get('x-forwarded-proto') || 'https';
    const host = forwardedHost || req.headers.get('host') || 'localhost:6001';
    const proto = forwardedHost ? forwardedProto : 'http';
    const serverUrl = `${proto}://${host}`;

    const payload = JSON.stringify({
      url: serverUrl,
      token: pairingToken,
      ts: Math.floor(Date.now() / 1000),
    });

    const qr = await QRCode.toDataURL(payload, {
      width: 280,
      margin: 2,
      color: { dark: '#f0f0f5', light: '#00000000' },
      errorCorrectionLevel: 'M',
    });

    return NextResponse.json({ qr, url: serverUrl, expiresIn: 300 });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to generate QR code', details: String(err) },
      { status: 500 }
    );
  }
}
