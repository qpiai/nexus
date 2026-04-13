interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export async function searchTavily(query: string, maxResults: number = 5): Promise<TavilyResult[]> {
  const apiKey = (process.env.TAVILY_API_KEY || '').trim();
  if (!apiKey) {
    // Search is supplementary — silently return empty if no key is configured.
    return [];
  }

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
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[Tavily] ${msg}`);
    return []; // search is supplementary — never crash the agent
  }
}
