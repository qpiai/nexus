import { NextRequest } from 'next/server';
import { getAgentState } from '@/lib/agent-state';
import { getUserFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const state = getAgentState(userId);

  return Response.json({
    running: state.running,
    events: state.events,
    error: state.error,
    done: state.done,
  });
}
