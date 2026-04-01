import type { NextRequest } from 'next/server';

const AUTH_SECRET = process.env.AUTH_SECRET || 'a3f8c1d4e7b2094f56a1c8d3e9b7024f61d8a3c5e2f7094b16a8c3d5e9f2047b';
const COOKIE_NAME = 'nexus_auth';
const TOKEN_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

export { COOKIE_NAME, TOKEN_MAX_AGE };

export interface TokenUser {
  userId: string;
  email: string;
  name: string;
  role: 'admin' | 'user';
  type?: 'user' | 'device';
  deviceId?: string;
}

// Use Web Crypto API (works in both Edge Runtime and Node.js)
const encoder = new TextEncoder();

async function hmacSign(data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return btoa(String.fromCharCode(...Array.from(new Uint8Array(sig))))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function hmacVerify(data: string, signature: string): Promise<boolean> {
  const expected = await hmacSign(data);
  return signature === expected;
}

export async function createToken(user: { id: string; email: string; name: string; role: 'admin' | 'user' }): Promise<string> {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    type: 'user',
    exp: Math.floor(Date.now() / 1000) + TOKEN_MAX_AGE,
  };
  const data = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sig = await hmacSign(data);
  return `${data}.${sig}`;
}

export async function createDeviceToken(userId: string, deviceId: string): Promise<string> {
  const payload = {
    sub: userId,
    deviceId,
    type: 'device',
    exp: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60, // 90 days
  };
  const data = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sig = await hmacSign(data);
  return `${data}.${sig}`;
}

export async function verifyToken(token: string): Promise<TokenUser | null> {
  try {
    const [data, sig] = token.split('.');
    if (!data || !sig) return null;

    const valid = await hmacVerify(data, sig);
    if (!valid) return null;

    const payload = JSON.parse(atob(data.replace(/-/g, '+').replace(/_/g, '/')));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;

    if (!payload.sub) return null;

    return {
      userId: payload.sub,
      email: payload.email || '',
      name: payload.name || '',
      role: payload.role || 'user',
      type: payload.type || 'user',
      deviceId: payload.deviceId,
    };
  } catch {
    return null;
  }
}

export async function createPairingToken(user: { id: string; email: string; name: string; role: 'admin' | 'user' }): Promise<string> {
  const payload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    type: 'user',
    exp: Math.floor(Date.now() / 1000) + 5 * 60, // 5 minutes
  };
  const data = btoa(JSON.stringify(payload))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const sig = await hmacSign(data);
  return `${data}.${sig}`;
}

export async function getUserFromRequest(req: NextRequest): Promise<TokenUser | null> {
  // Check cookie first
  let token = req.cookies.get(COOKIE_NAME)?.value;

  // Fallback to Authorization Bearer header
  if (!token) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) return null;
  return verifyToken(token);
}
