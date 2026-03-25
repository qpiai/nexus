import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const userId = user?.userId || 'default';
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Validate file type
    const name = file.name;
    if (!name.endsWith('.json') && !name.endsWith('.jsonl')) {
      return NextResponse.json({ error: 'Only .json and .jsonl files are supported' }, { status: 400 });
    }

    // Read file content
    const content = await file.text();

    // Validate format
    let samples = 0;
    let format = 'alpaca';

    try {
      if (name.endsWith('.jsonl')) {
        const lines = content.trim().split('\n').filter(l => l.trim());
        samples = lines.length;

        // Validate each line is valid JSON
        for (let i = 0; i < Math.min(lines.length, 5); i++) {
          const obj = JSON.parse(lines[i]);
          if (i === 0) {
            if (obj.conversations || obj.messages) {
              format = 'sharegpt';
            } else if (!obj.instruction && !obj.input && !obj.output) {
              // Check for at least some expected fields
              if (!obj.text && !obj.prompt && !obj.response) {
                return NextResponse.json({
                  error: 'Invalid format. Expected alpaca format (instruction/input/output) or sharegpt format (conversations/messages)',
                }, { status: 400 });
              }
            }
          }
        }
      } else {
        const data = JSON.parse(content);
        if (!Array.isArray(data)) {
          return NextResponse.json({ error: 'JSON file must contain an array of samples' }, { status: 400 });
        }
        samples = data.length;
        if (data.length > 0) {
          if (data[0].conversations || data[0].messages) {
            format = 'sharegpt';
          }
        }
      }
    } catch (e) {
      return NextResponse.json({ error: `Invalid JSON: ${(e as Error).message}` }, { status: 400 });
    }

    if (samples === 0) {
      return NextResponse.json({ error: 'Dataset is empty' }, { status: 400 });
    }

    // Save file
    const datasetsDir = path.resolve(process.cwd(), 'output', userId, 'datasets');
    fs.mkdirSync(datasetsDir, { recursive: true });

    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = path.join(datasetsDir, safeName);
    fs.writeFileSync(filePath, content, 'utf-8');

    return NextResponse.json({
      name: safeName.replace(/\.(json|jsonl)$/, ''),
      path: filePath,
      format,
      samples,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
