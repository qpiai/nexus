import { NextRequest } from 'next/server';
import path from 'path';

// ── Size Limits ──────────────────────────────────────────────
export const MAX_DATASET_ZIP_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
export const MAX_IMAGE_SIZE = 50 * 1024 * 1024; // 50 MB

// ── Name Sanitization ────────────────────────────────────────
/**
 * Strip path traversal characters and non-alphanumeric chars from a name.
 * Returns null if the result is empty.
 */
export function sanitizeName(name: string): string | null {
  const cleaned = name
    .replace(/\.\./g, '')
    .replace(/[/\\]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 128);
  return cleaned.length > 0 ? cleaned : null;
}

// ── Path Validation ──────────────────────────────────────────
/**
 * Resolve userPath and verify it is under baseDir. Throws on violation.
 */
export function validatePathUnderBase(userPath: string, baseDir: string): string {
  const resolved = path.resolve(userPath);
  const base = path.resolve(baseDir);
  if (!resolved.startsWith(base + path.sep) && resolved !== base) {
    throw new Error('Path traversal denied');
  }
  return resolved;
}

// ── Numeric Clamping ─────────────────────────────────────────
export function clampNumeric(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

// ── Error Sanitization ───────────────────────────────────────
/**
 * Strip absolute paths, ANSI codes, and truncate to 500 chars.
 */
export function sanitizeErrorMessage(msg: string, projectRoot?: string): string {
  let cleaned = msg;
  // Strip ANSI escape codes
  cleaned = cleaned.replace(/\x1b\[[0-9;]*m/g, '');
  // Strip project root paths
  if (projectRoot) {
    cleaned = cleaned.split(projectRoot).join('[project]');
  }
  // Strip common absolute path patterns
  cleaned = cleaned.replace(/\/(?:home|workspace|tmp|var|usr)[^\s'"):]*/g, '[path]');
  return cleaned.slice(0, 500);
}

// ── Safe Request Parsing ─────────────────────────────────────
export async function safeJsonParse(req: NextRequest): Promise<Record<string, unknown> | Response> {
  try {
    return await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }
}

export async function safeFormData(req: NextRequest): Promise<FormData | Response> {
  try {
    return await req.formData();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid form data' }), { status: 400 });
  }
}
