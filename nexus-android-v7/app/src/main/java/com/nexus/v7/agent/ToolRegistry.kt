package com.nexus.v7.agent

import android.content.Context

interface Tool {
    val name: String
    val description: String
    suspend fun execute(args: String): String
}

class ToolRegistry(private val context: Context) {
    private val tools = mutableMapOf<String, Tool>()

    fun register(tool: Tool) {
        tools[tool.name] = tool
    }

    fun describe(): String = tools.values.joinToString("\n") {
        "- ${it.name}: ${it.description}"
    }

    fun toolNames(): List<String> = tools.keys.toList()

    suspend fun execute(call: ToolCall): String {
        val tool = tools[call.name]
            ?: return "Error: unknown tool '${call.name}'. Available: ${tools.keys.joinToString()}"
        return try {
            tool.execute(call.args)
        } catch (e: Exception) {
            "Error executing ${call.name}: ${e.message}"
        }
    }
}
