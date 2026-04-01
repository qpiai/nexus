import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import type { Schema } from '@google/generative-ai';

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const GEMINI_KEYS = [
  process.env.GEMINI_API_KEY_1,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
].filter(Boolean) as string[];

let currentKeyIndex = 0;

function getNextKey(): string {
  if (GEMINI_KEYS.length === 0) {
    throw new Error('No Gemini API keys configured');
  }
  const key = GEMINI_KEYS[currentKeyIndex % GEMINI_KEYS.length];
  currentKeyIndex++;
  return key;
}

export async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  const maxRetries = GEMINI_KEYS.length * 2; // Try each key at least twice
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = getNextKey();
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt,
    });

    try {
      const result = await Promise.race([
        model.generateContent({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini request timed out after 30s')), 30000)
        ),
      ]);

      const response = result.response;
      const text = response.text();
      if (text && text.trim().length > 0) {
        return text;
      }
      throw new Error('Empty response from Gemini');
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isRateLimit = lastError.message.includes('429') || lastError.message.includes('quota');
      const isTimeout = lastError.message.includes('timed out');

      // On rate limit, immediately try next key
      if (isRateLimit) {
        console.log(`[Gemini] Key ${attempt % GEMINI_KEYS.length + 1} rate limited, rotating...`);
        continue;
      }

      // On timeout or other error, wait a bit then retry
      if (!isTimeout) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Gemini API failed after ${maxRetries} attempts: ${lastError?.message}`);
}

export async function* callGeminiStream(
  systemPrompt: string,
  userPrompt: string
): AsyncGenerator<string> {
  const maxRetries = GEMINI_KEYS.length * 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = getNextKey();
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt,
    });

    try {
      const result = await model.generateContentStream({
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
      });

      for await (const chunk of result.stream) {
        const text = chunk.text();
        if (text) {
          yield text;
        }
      }
      return; // Success
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isRateLimit = lastError.message.includes('429') || lastError.message.includes('quota');

      if (isRateLimit) {
        console.log(`[Gemini Stream] Key ${attempt % GEMINI_KEYS.length + 1} rate limited, rotating...`);
        continue;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error(`Gemini streaming failed after ${maxRetries} attempts: ${lastError?.message}`);
}

export { SchemaType };
export type { Schema };

export async function callGeminiJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  responseSchema: Schema,
): Promise<T> {
  const maxRetries = GEMINI_KEYS.length * 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const key = getNextKey();
    const genAI = new GoogleGenerativeAI(key);
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      systemInstruction: systemPrompt,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema,
      },
    });

    try {
      const result = await Promise.race([
        model.generateContent({
          contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini JSON request timed out after 120s')), 120000)
        ),
      ]);

      const response = result.response;
      const text = response.text();
      if (!text || text.trim().length === 0) {
        throw new Error('Empty response from Gemini');
      }

      return JSON.parse(text) as T;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const isRateLimit = lastError.message.includes('429') || lastError.message.includes('quota');
      const isTimeout = lastError.message.includes('timed out');

      if (isRateLimit) {
        console.log(`[Gemini JSON] Key ${attempt % GEMINI_KEYS.length + 1} rate limited, rotating...`);
        continue;
      }

      if (!isTimeout) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Gemini JSON API failed after ${maxRetries} attempts: ${lastError?.message}`);
}
