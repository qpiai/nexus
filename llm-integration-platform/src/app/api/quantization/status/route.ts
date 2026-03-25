import { NextRequest } from 'next/server';
import { getQuantizeState } from '@/lib/quantize-state';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const state = getQuantizeState(userId);

  return Response.json({
    running: state.running,
    model: state.model,
    method: state.method,
    bits: state.bits,
    progress: state.progress,
    logs: state.logs,
    error: state.error,
    done: state.done,
    outputFile: state.outputFile,
    outputDir: state.outputDir,
  });
}
