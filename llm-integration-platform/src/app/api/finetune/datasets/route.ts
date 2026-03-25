import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface DatasetEntry {
  id: string;
  name: string;
  format: string;
  samples: number;
  description: string;
  isLocal: boolean;
}

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const datasets: DatasetEntry[] = [];

  // Check for uploaded datasets in user dir
  const datasetsDir = path.resolve(process.cwd(), 'output', userId, 'datasets');
  if (fs.existsSync(datasetsDir)) {
    const files = fs.readdirSync(datasetsDir);
    for (const file of files) {
      if (!file.endsWith('.json') && !file.endsWith('.jsonl')) continue;

      const filePath = path.join(datasetsDir, file);
      let samples = 0;
      let format = 'alpaca';

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n');

        if (file.endsWith('.jsonl')) {
          samples = lines.length;
          // Check format from first line
          const first = JSON.parse(lines[0]);
          if (first.conversations || first.messages) format = 'sharegpt';
        } else {
          const data = JSON.parse(content);
          if (Array.isArray(data)) {
            samples = data.length;
            if (data[0]?.conversations || data[0]?.messages) format = 'sharegpt';
          }
        }
      } catch {
        // skip unparseable files
      }

      datasets.push({
        id: filePath,
        name: file.replace(/\.(json|jsonl)$/, ''),
        format,
        samples,
        description: `Local dataset (${samples} samples)`,
        isLocal: true,
      });
    }
  }

  return NextResponse.json({ datasets });
}
