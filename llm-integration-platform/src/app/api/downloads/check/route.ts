import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { ok: boolean; at: number }>();

async function probe(url: string): Promise<boolean> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.ok;

  let ok = false;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    ok = res.ok;
    if (!ok && (res.status === 403 || res.status === 405)) {
      // Some CDNs reject HEAD; fall back to a ranged GET for 1 byte.
      const r2 = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        headers: { Range: 'bytes=0-0' },
      });
      ok = r2.ok || r2.status === 206;
    }
  } catch {
    ok = false;
  }

  cache.set(url, { ok, at: Date.now() });
  return ok;
}

export async function POST(req: NextRequest) {
  let urls: string[] = [];
  try {
    const body = await req.json();
    urls = Array.isArray(body?.urls) ? body.urls.filter((u: unknown) => typeof u === 'string') : [];
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (urls.length === 0) return NextResponse.json({});
  if (urls.length > 32) return NextResponse.json({ error: 'too many urls' }, { status: 400 });

  const entries = await Promise.all(urls.map(async (u) => [u, await probe(u)] as const));
  return NextResponse.json(Object.fromEntries(entries));
}
