import { NextRequest } from 'next/server';
import { getQuantizeState, pushQuantizeLog } from '@/lib/quantize-state';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const quantizeState = getQuantizeState(userId);

  if (!quantizeState.running) {
    return Response.json({ error: 'No quantization job is currently running' }, { status: 400 });
  }

  if (quantizeState.process && !quantizeState.process.killed) {
    quantizeState.process.kill('SIGTERM');
    // Give it a moment, then SIGKILL if still alive
    setTimeout(() => {
      if (quantizeState.process && !quantizeState.process.killed) {
        quantizeState.process.kill('SIGKILL');
      }
    }, 5000);
  }

  quantizeState.running = false;
  quantizeState.error = 'Stopped by user';
  pushQuantizeLog(userId, { type: 'error', message: 'Stopped by user' });

  return Response.json({ success: true, message: 'Quantization process stopped' });
}
