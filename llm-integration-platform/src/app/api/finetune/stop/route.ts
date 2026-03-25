import { NextRequest } from 'next/server';
import { getFinetuneState, pushLog } from '@/lib/finetune-state';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const finetuneState = getFinetuneState(userId);

  if (!finetuneState.running) {
    return Response.json({ error: 'No finetuning job is currently running' }, { status: 400 });
  }

  if (finetuneState.process && !finetuneState.process.killed) {
    finetuneState.process.kill('SIGTERM');
    // Give it a moment, then SIGKILL if still alive
    setTimeout(() => {
      if (finetuneState.process && !finetuneState.process.killed) {
        finetuneState.process.kill('SIGKILL');
      }
    }, 5000);
  }

  finetuneState.running = false;
  finetuneState.error = 'Training stopped by user';
  pushLog(userId, { type: 'error', message: 'Training stopped by user' });

  return Response.json({ success: true, message: 'Training process stopped' });
}
