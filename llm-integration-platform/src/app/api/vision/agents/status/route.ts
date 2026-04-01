import { NextRequest } from 'next/server';
import { getVisionAgentState } from '@/lib/vision-agent-state';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const state = getVisionAgentState(userId);

  return Response.json({
    running: state.running,
    events: state.events,
    error: state.error,
    done: state.done,
  });
}
