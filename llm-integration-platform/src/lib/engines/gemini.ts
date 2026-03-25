import { GoogleGenerativeAI } from '@google/generative-ai';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

export async function callGemini(systemPrompt: string, userPrompt: string): Promise<string> {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured. Set it in your .env file.');
  }

  const maxRetries = 3;
  let lastError: Error | null = null;

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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

      if (isRateLimit) {
        console.log(`[Gemini] Rate limited (attempt ${attempt + 1}/${maxRetries}), waiting...`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

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
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured. Set it in your .env file.');
  }

  const maxRetries = 3;
  let lastError: Error | null = null;

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
  });

  for (let attempt = 0; attempt < maxRetries; attempt++) {
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
        console.log(`[Gemini Stream] Rate limited (attempt ${attempt + 1}/${maxRetries}), waiting...`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      const delay = Math.min(1000 * Math.pow(2, attempt), 8000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw new Error(`Gemini streaming failed after ${maxRetries} attempts: ${lastError?.message}`);
}
