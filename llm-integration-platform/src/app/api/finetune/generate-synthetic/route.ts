import { NextRequest } from 'next/server';
import { callGeminiJSON, SchemaType } from '@/lib/engines/gemini';
import type { Schema } from '@/lib/engines/gemini';
import { getUserFromRequest } from '@/lib/auth';
import type { SyntheticDataConfig, AlpacaSample, ShareGPTSample } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ALPACA_SCHEMA: Schema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      instruction: { type: SchemaType.STRING, description: 'The task instruction' },
      input: { type: SchemaType.STRING, description: 'Optional input context (can be empty)' },
      output: { type: SchemaType.STRING, description: 'The expected response' },
    },
    required: ['instruction', 'input', 'output'],
  },
};

const SHAREGPT_SCHEMA: Schema = {
  type: SchemaType.ARRAY,
  items: {
    type: SchemaType.OBJECT,
    properties: {
      conversations: {
        type: SchemaType.ARRAY,
        items: {
          type: SchemaType.OBJECT,
          properties: {
            from: { type: SchemaType.STRING, description: 'Speaker role: human or gpt' },
            value: { type: SchemaType.STRING, description: 'The message content' },
          },
          required: ['from', 'value'],
        },
      },
    },
    required: ['conversations'],
  },
};

function buildPrompt(config: SyntheticDataConfig): { system: string; user: string } {
  const baseSystem = config.customPrompt || config.topic;

  if (config.format === 'alpaca') {
    return {
      system: `You are a synthetic training data generator. Produce high-quality instruction-response pairs in Alpaca format.

Each element must have: instruction, input (empty string "" if not needed), output.
- Instructions should be diverse, specific, actionable
- Outputs should be detailed and helpful
- Vary complexity across samples`,
      user: `Topic: ${baseSystem}

Generate exactly ${config.count} Alpaca-format samples.`,
    };
  }

  return {
    system: `You are a synthetic training data generator. Produce high-quality multi-turn conversations in ShareGPT format.

Each element must have a "conversations" array with objects containing "from" (either "human" or "gpt") and "value".
- Start with "human", alternate roles
- 2-6 turns per conversation
- Vary topics and complexity`,
    user: `Topic: ${baseSystem}

Generate exactly ${config.count} ShareGPT-format conversations.`,
  };
}

export async function POST(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const body = await req.json();
  const config: SyntheticDataConfig = body.config;

  if (!config?.topic || !config?.format || !config?.count) {
    return new Response(JSON.stringify({ error: 'Missing config fields: topic, format, count' }), { status: 400 });
  }

  const count = Math.min(Math.max(config.count, 1), 500);
  const batchSize = Math.min(count, 10);
  const batches = Math.ceil(count / batchSize);
  const schema = config.format === 'alpaca' ? ALPACA_SCHEMA : SHAREGPT_SCHEMA;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;

      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      }

      try {
        const allSamples: (AlpacaSample | ShareGPTSample)[] = [];

        send('progress', { message: `Generating ${count} samples in ${batches} batch(es)...`, progress: 0 });

        for (let i = 0; i < batches; i++) {
          const remaining = count - allSamples.length;
          const thisBatch = Math.min(batchSize, remaining);

          send('progress', {
            message: `Batch ${i + 1}/${batches}: Generating ${thisBatch} samples via Gemini...`,
            progress: allSamples.length / count,
          });

          const batchConfig = { ...config, count: thisBatch };
          const { system, user: userPrompt } = buildPrompt(batchConfig);

          let samples: (AlpacaSample | ShareGPTSample)[];
          try {
            const parsed = await callGeminiJSON<unknown[]>(system, userPrompt, schema);
            if (!Array.isArray(parsed)) {
              throw new Error('Response is not a JSON array');
            }
            samples = parsed.filter((item) => {
              const obj = item as Record<string, unknown>;
              if (config.format === 'alpaca') {
                return typeof obj.instruction === 'string' && typeof obj.output === 'string';
              }
              return Array.isArray(obj.conversations) && obj.conversations.length >= 2;
            }) as (AlpacaSample | ShareGPTSample)[];
          } catch (err) {
            const msg = (err as Error).message;
            console.error('[generate-synthetic] Gemini JSON failed:', msg);
            // Retry once
            send('progress', { message: `Error, retrying batch ${i + 1}...`, progress: allSamples.length / count });
            try {
              const parsed = await callGeminiJSON<unknown[]>(system, userPrompt, schema);
              if (!Array.isArray(parsed)) {
                throw new Error('Response is not a JSON array');
              }
              samples = parsed.filter((item) => {
                const obj = item as Record<string, unknown>;
                if (config.format === 'alpaca') {
                  return typeof obj.instruction === 'string' && typeof obj.output === 'string';
                }
                return Array.isArray(obj.conversations) && obj.conversations.length >= 2;
              }) as (AlpacaSample | ShareGPTSample)[];
            } catch (retryErr) {
              send('error', { message: `Gemini API error: ${(retryErr as Error).message}` });
              break;
            }
          }

          for (const sample of samples) {
            allSamples.push(sample);
            send('sample', { index: allSamples.length - 1, sample });
          }

          send('progress', {
            message: `Generated ${allSamples.length}/${count} samples`,
            progress: allSamples.length / count,
          });
        }

        if (allSamples.length > 0) {
          send('complete', {
            message: `Generated ${allSamples.length} samples`,
            total: allSamples.length,
            progress: 1,
          });
        }
      } catch (err) {
        console.error('[generate-synthetic] Unexpected error:', (err as Error).message);
        send('error', { message: (err as Error).message });
      }

      if (!closed) {
        try {
          controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
          controller.close();
        } catch { /* already closed */ }
      }
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
