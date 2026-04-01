package com.nexus.v7.agent.tools

import android.content.Context
import com.nexus.v7.agent.Tool
import java.io.File

class FileReadTool(private val context: Context) : Tool {
    override val name = "file_read"
    override val description = "Read a file from app storage. Usage: file_read(filename)"

    override suspend fun execute(args: String): String {
        val filename = args.trim()
        if (filename.isEmpty()) return "Error: filename required"
        if (filename.contains("..") || filename.contains("/")) {
            return "Error: invalid filename (no path traversal allowed)"
        }

        val file = File(context.filesDir, filename)
        return if (file.exists() && file.isFile) {
            val content = file.readText()
            if (content.length > 2000) content.take(2000) + "... [truncated]"
            else content
        } else {
            "File not found: $filename"
        }
    }
}
