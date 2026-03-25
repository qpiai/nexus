import { NextRequest } from 'next/server';
import { getVisionTrainState } from '@/lib/vision-train-state';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const visionTrainState = getVisionTrainState(userId);

  if (!visionTrainState.process || visionTrainState.process.killed) {
    return new Response(JSON.stringify({ error: 'No training job is running' }), { status: 400 });
  }

  // Capture process reference and PID before any async work
  const proc = visionTrainState.process;
  const pid = proc.pid;

  // Register close handler BEFORE sending signal to avoid race
  const killTimeout = setTimeout(() => {
    try {
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    } catch { /* process may have already exited */ }
  }, 10000);

  proc.on('close', () => {
    clearTimeout(killTimeout);
  });

  // Send SIGTERM for graceful shutdown
  try {
    proc.kill('SIGTERM');
  } catch { /* process may have already exited */ }

  visionTrainState.running = false;
  visionTrainState.error = 'Training stopped by user';
  visionTrainState.logs.push({
    type: 'error',
    message: 'Training stopped by user',
  });

  return new Response(JSON.stringify({ stopped: true, pid }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
