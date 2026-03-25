interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || '';

export async function searchTavily(query: string, maxResults: number = 5): Promise<TavilyResult[]> {
  if (!TAVILY_API_KEY) {
    console.warn('[Tavily] TAVILY_API_KEY is not configured. Skipping web search.');
    return [];
  }

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query,
          search_depth: 'advanced',
          max_results: maxResults,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        console.log(`[Tavily] Rate limited (attempt ${attempt + 1}/${maxRetries}), waiting...`);
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Tavily API returned ${res.status}: ${text}`);
      }

      const data = await res.json();
      return (data.results || []).map((r: { title: string; url: string; content: string }) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      }));
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (lastError.message.includes('429') || lastError.message.includes('rate')) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  console.error(`[Tavily] Failed after ${maxRetries} attempts: ${lastError?.message}`);
  return [];
}
