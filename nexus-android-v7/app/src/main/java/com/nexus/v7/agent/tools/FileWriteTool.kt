package com.nexus.v7.agent.tools

import android.content.Context
import com.nexus.v7.agent.Tool
import java.io.File

class FileWriteTool(private val context: Context) : Tool {
    override val name = "file_write"
    override val description = "Write content to a file in app storage. Usage: file_write(filename|content)"

    override suspend fun execute(args: String): String {
        val parts = args.split("|", limit = 2)
        if (parts.size < 2) return "Error: format is filename|content"
        val filename = parts[0].trim()
        val content = parts[1]
        if (filename.contains("..") || filename.contains("/")) {
            return "Error: invalid filename (no path traversal allowed)"
        }
        val file = File(context.filesDir, filename)
        file.writeText(content)
        return "Written ${content.length} chars to $filename"
    }
}
