import { NextRequest } from 'next/server';
import { runVisionAgentWorkflow } from '@/lib/engines/vision-agent-system';
import { VisionAgentRunRequest } from '@/lib/types';
import { getUserFromRequest } from '@/lib/auth';
import { getVisionAgentState, resetVisionAgentState, pushVisionAgentEvent } from '@/lib/vision-agent-state';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  const userId = user?.userId || 'default';
  const body = await req.json() as VisionAgentRunRequest;
  const { useCase, feedback, previousMessages } = body;

  if (!useCase?.description) {
    return new Response(JSON.stringify({ error: 'Missing use case description' }), { status: 400 });
  }

  const state = getVisionAgentState(userId);

  // If not already running, fire-and-forget the generator
  if (!state.running) {
    resetVisionAgentState(userId);
    const freshState = getVisionAgentState(userId);
    freshState.running = true;
    freshState.startTime = Date.now();

    const options = feedback || previousMessages
      ? { feedback, previousMessages }
      : undefined;

    // Fire-and-forget: runs independently of SSE stream
    (async () => {
      try {
        for await (const event of runVisionAgentWorkflow(useCase, options, userId)) {
          pushVisionAgentEvent(userId, event.type, event.data as unknown as Record<string, unknown>);
        }
        freshState.done = true;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Workflow failed';
        freshState.error = msg;
        pushVisionAgentEvent(userId, 'error', { error: msg });
      } finally {
        freshState.running = false;
      }
    })();
  }

  // SSE stream: tail events from state using a cursor
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let cursor = 0;
      let closed = false;

      function sendNew() {
        const currentState = getVisionAgentState(userId);
        const newEvents = currentState.events.slice(cursor);
        for (const evt of newEvents) {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${evt.type}\ndata: ${JSON.stringify(evt.data)}\n\n`));
          } catch {
            closed = true;
            return;
          }
        }
        cursor = currentState.events.length;
      }

      // Poll state every 500ms, send new events
      const interval = setInterval(() => {
        if (closed) {
          clearInterval(interval);
          return;
        }

        sendNew();

        const currentState = getVisionAgentState(userId);
        if (!currentState.running) {
          sendNew(); // flush remaining
          clearInterval(interval);
          if (!closed) {
            closed = true;
            try {
              controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
              controller.close();
            } catch { /* already closed */ }
          }
        }
      }, 500);

      // Safety: close after maxDuration
      setTimeout(() => {
        clearInterval(interval);
        if (!closed) {
          closed = true;
          try { controller.close(); } catch { /* already closed */ }
        }
      }, 115000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
