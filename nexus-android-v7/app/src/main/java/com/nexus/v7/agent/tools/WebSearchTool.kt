package com.nexus.v7.agent.tools

import com.nexus.v7.agent.Tool
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class WebSearchTool : Tool {
    override val name = "web_search"
    override val description = "Search the web for information. Usage: web_search(query)"

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    override suspend fun execute(args: String): String = withContext(Dispatchers.IO) {
        val query = args.trim()
        if (query.isEmpty()) return@withContext "Error: search query cannot be empty"

        try {
            val encoded = URLEncoder.encode(query, "UTF-8")
            val url = "https://html.duckduckgo.com/html/?q=$encoded"

            val request = Request.Builder().url(url)
                .header("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36")
                .build()

            val response = client.newCall(request).execute()
            val html = response.body?.string() ?: ""
            response.close()

            val results = parseSearchResults(html)
            if (results.isEmpty()) "No results found for: $query"
            else results.take(5).joinToString("\n\n") { "${it.first}\n${it.second}" }
        } catch (e: Exception) {
            "Search error: ${e.message}"
        }
    }

    private fun parseSearchResults(html: String): List<Pair<String, String>> {
        val results = mutableListOf<Pair<String, String>>()
        val titleRegex = Regex("""<a[^>]*class="result__a"[^>]*>(.*?)</a>""")
        val snippetRegex = Regex("""<a[^>]*class="result__snippet"[^>]*>(.*?)</a>""")

        val titles = titleRegex.findAll(html).map { it.groupValues[1].replace(Regex("<[^>]+>"), "").trim() }.toList()
        val snippets = snippetRegex.findAll(html).map { it.groupValues[1].replace(Regex("<[^>]+>"), "").trim() }.toList()

        for (i in titles.indices) {
            val title = titles[i]
            val snippet = snippets.getOrElse(i) { "" }
            if (title.isNotEmpty()) results.add(Pair(title, snippet))
        }
        return results
    }
}
