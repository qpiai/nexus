import { NextRequest } from 'next/server';
import { runNexusAgent } from '@/lib/engines/nexus-agent';
import { getUserFromRequest } from '@/lib/auth';
import { AgentChatMessage } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await req.json();
  const { messages, pageContext } = body as {
    messages: AgentChatMessage[];
    pageContext: string;
  };

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: 'Messages required' }), { status: 400 });
  }

  const cookies = req.headers.get('cookie') || '';
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runNexusAgent(messages, pageContext || '/', cookies)) {
          controller.enqueue(
            encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`)
          );
        }
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
        controller.close();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Agent failed';
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`)
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
