import { NextRequest, NextResponse } from 'next/server';
import type { HFDatasetMeta } from '@/lib/types';

export const dynamic = 'force-dynamic';

// Simple in-memory cache with 5-minute TTL
const cache = new Map<string, { data: HFDatasetMeta; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');

  if (!id || !id.includes('/')) {
    return NextResponse.json(
      { error: 'Invalid dataset ID. Use format: org/dataset-name' },
      { status: 400 }
    );
  }

  // Check cache
  const cached = cache.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return NextResponse.json(cached.data);
  }

  try {
    // Fetch dataset info from HuggingFace API
    const res = await fetch(`https://huggingface.co/api/datasets/${encodeURIComponent(id)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 404) {
      return NextResponse.json({ error: 'Dataset not found on HuggingFace' }, { status: 404 });
    }

    if (!res.ok) {
      return NextResponse.json(
        { error: `HuggingFace returned ${res.status}. Try again later.` },
        { status: 502 }
      );
    }

    const data = await res.json();

    // Extract splits from cardData or dataset_info
    const splits: Record<string, number> = {};
    if (data.cardData?.dataset_info) {
      const info = Array.isArray(data.cardData.dataset_info)
        ? data.cardData.dataset_info[0]
        : data.cardData.dataset_info;
      if (info?.splits) {
        for (const s of info.splits) {
          splits[s.name] = s.num_examples || s.num_bytes || 0;
        }
      }
    }

    // Check features for image columns
    let hasImages = false;
    const features: string[] = [];

    if (data.cardData?.dataset_info) {
      const info = Array.isArray(data.cardData.dataset_info)
        ? data.cardData.dataset_info[0]
        : data.cardData.dataset_info;
      if (info?.features) {
        for (const f of info.features) {
          features.push(f.name || 'unknown');
          if (f.dtype === 'image' || f._type === 'Image' ||
              (typeof f.dtype === 'object' && f.dtype?._type === 'Image')) {
            hasImages = true;
          }
        }
      }
    }

    // Also check tags for image indicators
    if (data.tags?.includes('image') || data.tags?.includes('vision') ||
        data.tags?.includes('image-text') || data.tags?.includes('multimodal')) {
      hasImages = true;
    }

    const meta: HFDatasetMeta = {
      id: data.id || id,
      description: data.description || data.cardData?.description || '',
      downloads: data.downloads || 0,
      splits,
      features,
      hasImages,
    };

    // Cache the result
    cache.set(id, { data: meta, ts: Date.now() });

    return NextResponse.json(meta);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return NextResponse.json({ error: 'Request to HuggingFace timed out. Try again.' }, { status: 504 });
    }
    return NextResponse.json(
      { error: 'Could not reach HuggingFace. Try again.' },
      { status: 502 }
    );
  }
}
