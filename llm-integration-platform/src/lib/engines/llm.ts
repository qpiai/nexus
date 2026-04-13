/**
 * Provider-agnostic LLM client.
 *
 * Env:
 *   LLM_PROVIDER    google | openai | anthropic | openai-compatible
 *   LLM_MODEL       any model name the provider accepts
 *   LLM_API_KEY     required
 *   LLM_API_BASE    optional — for openai-compatible endpoints (LiteLLM, OpenRouter,
 *                   Ollama, vLLM, TGI, LocalAI…)
 */

import { generateObject, generateText, jsonSchema, streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { SchemaType } from '@google/generative-ai';
import type { Schema } from '@google/generative-ai';

// Re-export so existing callers that do `import { SchemaType } from '@/lib/engines/gemini'` keep working.
export { SchemaType };
export type { Schema };

type Provider = 'google' | 'openai' | 'anthropic' | 'openai-compatible';

interface ResolvedConfig {
  provider: Provider;
  model: string;
  apiKey: string;
  baseURL?: string;
}

function resolveConfig(): ResolvedConfig {
  const provider = ((process.env.LLM_PROVIDER || 'google').trim().toLowerCase()) as Provider;
  const apiKey = (process.env.LLM_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('LLM_API_KEY is not set. Add it to your .env.');
  }
  return {
    provider,
    model: process.env.LLM_MODEL || 'gemini-3.1-flash-lite-preview',
    apiKey,
    baseURL: process.env.LLM_API_BASE?.trim() || undefined,
  };
}

function buildModel(cfg: ResolvedConfig) {
  switch (cfg.provider) {
    case 'google':
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey })(cfg.model);
    case 'openai':
      return createOpenAI({ apiKey: cfg.apiKey })(cfg.model);
    case 'openai-compatible':
      return createOpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseURL })(cfg.model);
    case 'anthropic':
      return createAnthropic({ apiKey: cfg.apiKey })(cfg.model);
    default:
      throw new Error(`Unsupported LLM_PROVIDER: ${cfg.provider}`);
  }
}

/** Convert a Google-SDK Schema (with SchemaType.* enum values) to plain JSON Schema. */
function toJsonSchema(s: Schema): Record<string, unknown> {
  const raw = s as unknown as Record<string, unknown>;
  const rawType = raw.type;
  const type =
    typeof rawType === 'string' ? rawType.toLowerCase() : String(rawType || 'string').toLowerCase();

  const out: Record<string, unknown> = { type };
  if (raw.description) out.description = raw.description;
  if (raw.enum) out.enum = raw.enum;
  if (raw.items) out.items = toJsonSchema(raw.items as Schema);
  if (raw.properties) {
    const props = raw.properties as Record<string, Schema>;
    out.properties = Object.fromEntries(
      Object.entries(props).map(([k, v]) => [k, toJsonSchema(v)]),
    );
  }
  if (raw.required) out.required = raw.required;
  return out;
}

export async function callLLM(systemPrompt: string, userPrompt: string): Promise<string> {
  const cfg = resolveConfig();
  const { text } = await Promise.race([
    generateText({
      model: buildModel(cfg),
      system: systemPrompt,
      prompt: userPrompt,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('LLM request timed out after 30s')), 30000),
    ),
  ]);
  if (!text || text.trim().length === 0) {
    throw new Error('Empty response from LLM');
  }
  return text;
}

export async function* callLLMStream(
  systemPrompt: string,
  userPrompt: string,
): AsyncGenerator<string> {
  const cfg = resolveConfig();
  const result = streamText({
    model: buildModel(cfg),
    system: systemPrompt,
    prompt: userPrompt,
  });
  for await (const chunk of result.textStream) {
    if (chunk) yield chunk;
  }
}

export async function callLLMJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  responseSchema: Schema,
): Promise<T> {
  const cfg = resolveConfig();
  const schema = jsonSchema<T>(toJsonSchema(responseSchema) as never);
  const { object } = await Promise.race([
    generateObject({
      model: buildModel(cfg),
      system: systemPrompt,
      prompt: userPrompt,
      schema,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('LLM JSON request timed out after 120s')), 120000),
    ),
  ]);
  return object as T;
}
