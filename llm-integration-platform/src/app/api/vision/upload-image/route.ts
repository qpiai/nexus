import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';
import {
  safeFormData,
  sanitizeErrorMessage,
  MAX_IMAGE_SIZE,
} from '@/lib/vision-validation';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.bmp'];

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const projectRoot = process.cwd();

  try {
    const formDataOrErr = await safeFormData(req);
    if (formDataOrErr instanceof Response) return formDataOrErr;
    const formData = formDataOrErr;

    const file = formData.get('file') as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file uploaded' }), { status: 400 });
    }

    if (file.size > MAX_IMAGE_SIZE) {
      return new Response(JSON.stringify({ error: 'File too large (max 50 MB)' }), { status: 400 });
    }

    const ext = path.extname(file.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      return new Response(
        JSON.stringify({ error: `Invalid file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` }),
        { status: 400 }
      );
    }

    const uploadDir = path.resolve(projectRoot, 'output', userId, 'vision_uploads');
    fs.mkdirSync(uploadDir, { recursive: true });

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${timestamp}_${safeName}`;
    const filePath = path.join(uploadDir, filename);

    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    return new Response(JSON.stringify({
      filename,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: sanitizeErrorMessage((err as Error).message, projectRoot) }), { status: 500 });
  }
}
