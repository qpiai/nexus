package com.nexus.v7.agent.tools

import com.nexus.v7.agent.Tool
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

class WebFetchTool : Tool {
    override val name = "web_fetch"
    override val description = "Fetch content from a URL. Usage: web_fetch(https://example.com)"

    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .followRedirects(true)
        .build()

    override suspend fun execute(args: String): String = withContext(Dispatchers.IO) {
        val url = args.trim()
        if (!url.startsWith("http")) return@withContext "Error: URL must start with http:// or https://"

        try {
            val request = Request.Builder().url(url)
                .header("User-Agent", "NexusBot/1.0")
                .build()
            val response = client.newCall(request).execute()
            val body = response.body?.string() ?: ""
            response.close()

            // Strip HTML tags for readability
            val text = body.replace(Regex("<script[^>]*>[\\s\\S]*?</script>"), "")
                .replace(Regex("<style[^>]*>[\\s\\S]*?</style>"), "")
                .replace(Regex("<[^>]+>"), " ")
                .replace(Regex("\\s+"), " ")
                .trim()

            if (text.length > 2000) text.take(2000) + "... [truncated]"
            else text
        } catch (e: Exception) {
            "Error fetching URL: ${e.message}"
        }
    }
}
