interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

const TAVILY_KEYS = [
  process.env.TAVILY_API_KEY_1,
  process.env.TAVILY_API_KEY_2,
  process.env.TAVILY_API_KEY_3,
].filter(Boolean) as string[];

let currentTavilyKeyIndex = 0;

function getNextTavilyKey(): string {
  if (TAVILY_KEYS.length === 0) {
    throw new Error('No Tavily API keys configured');
  }
  const key = TAVILY_KEYS[currentTavilyKeyIndex % TAVILY_KEYS.length];
  currentTavilyKeyIndex++;
  return key;
}

export async function searchTavily(query: string, maxResults: number = 5): Promise<TavilyResult[]> {
  const maxRetries = TAVILY_KEYS.length * 2;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const apiKey = getNextTavilyKey();

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          search_depth: 'advanced',
          max_results: maxResults,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.status === 429) {
        console.log(`[Tavily] Key ${attempt % TAVILY_KEYS.length + 1} rate limited, rotating...`);
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
        continue;
      }
      const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Return empty results instead of crashing - search is supplementary
  console.error(`[Tavily] All keys exhausted: ${lastError?.message}`);
  return [];
}
