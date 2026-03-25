import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { loadUsers } from '@/lib/users';
import fs from 'fs';
import path from 'path';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const users = loadUsers();

  const totalUsers = users.length;
  const localUsers = users.filter(u => u.provider === 'local').length;
  const googleUsers = users.filter(u => u.provider === 'google').length;

  // Count models across all user output directories
  let totalModels = 0;
  const outputDir = path.resolve(process.cwd(), 'output');
  if (fs.existsSync(outputDir)) {
    try {
      const entries = fs.readdirSync(outputDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('_work_') || entry.name === 'datasets') continue;
        if (entry.isFile() && entry.name.endsWith('.gguf')) {
          totalModels++;
        } else if (entry.isDirectory()) {
          // Check if it's a UUID user dir — count models inside
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.name)) {
            const userDir = path.join(outputDir, entry.name);
            try {
              const userEntries = fs.readdirSync(userDir, { withFileTypes: true });
              for (const ue of userEntries) {
                if (ue.isFile() && ue.name.endsWith('.gguf')) totalModels++;
                else if (ue.isDirectory() && !ue.name.startsWith('_work_')) totalModels++;
              }
            } catch { /* skip unreadable dirs */ }
          } else if (entry.name.includes('-awq-') || entry.name.includes('-gptq-') || entry.name.includes('-bitnet-') || entry.name.includes('-mlx-') || entry.name.endsWith('-fp16')) {
            totalModels++;
          }
        }
      }
    } catch { /* ignore */ }
  }

  return NextResponse.json({
    totalUsers,
    localUsers,
    googleUsers,
    totalModels,
  });
}
