package com.nexus.v7.agent

import android.util.Log
import com.nexus.v7.engine.LlamaEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.withContext

class AgentLoop(
    private val llamaEngine: LlamaEngine,
    private val toolRegistry: ToolRegistry
) {
    companion object {
        private const val TAG = "AgentLoop"
        const val MAX_STEPS = 5
        private val TOOL_REGEX = Regex("""<tool>(\w+)\((.*?)\)</tool>""", RegexOption.DOT_MATCHES_ALL)
    }

    fun run(userMessage: String, chatHistory: List<ChatMessage> = emptyList()): Flow<AgentEvent> = flow {
        val messages = mutableListOf<ChatMessage>()
        messages.add(ChatMessage("system", buildSystemPrompt()))

        for (msg in chatHistory.takeLast(4)) {
            messages.add(msg)
        }
        messages.add(ChatMessage("user", userMessage))

        for (step in 0 until MAX_STEPS) {
            Log.d(TAG, "Agent step ${step + 1}/$MAX_STEPS")

            val response = StringBuilder()
            val prompt = formatMessages(messages)

            llamaEngine.chat(prompt, 512).collect { token ->
                response.append(token)
                emit(AgentEvent.Token(token))
            }

            val responseText = response.toString().trim()
            val cleanResponse = responseText
                .removePrefix("Assistant:")
                .trimStart()

            val toolCalls = parseToolCalls(cleanResponse)

            if (toolCalls.isEmpty()) {
                emit(AgentEvent.FinalAnswer(cleanResponse))
                return@flow
            }

            messages.add(ChatMessage("assistant", cleanResponse))

            for (call in toolCalls) {
                Log.d(TAG, "Executing tool: ${call.name}(${call.args})")
                emit(AgentEvent.ToolExecution(call.name, call.args))

                val result = withContext(Dispatchers.IO) {
                    toolRegistry.execute(call)
                }

                Log.d(TAG, "Tool result (${result.length} chars): ${result.take(100)}...")
                emit(AgentEvent.ToolResult(call.name, result))

                messages.add(ChatMessage("tool", "[${call.name}] result:\n$result"))
            }

            messages.add(ChatMessage("user", "Use the tool results above to answer the original question. If you need more information, use another tool. Otherwise, provide your final answer directly without any <tool> tags."))
        }

        emit(AgentEvent.FinalAnswer("I reached the maximum number of steps ($MAX_STEPS). Here's what I found so far."))
    }.flowOn(Dispatchers.Main)

    private fun buildSystemPrompt(): String {
        return """You are a helpful AI assistant running on an Android device.
You have access to tools. To use a tool, write exactly:
<tool>tool_name(argument)</tool>

Available tools:
${toolRegistry.describe()}

Rules:
- Use tools ONLY when the user's request requires information you don't have or actions you can't perform directly.
- For simple questions (facts, math, general knowledge), answer directly WITHOUT using any tools.
- After receiving tool results, provide your final answer to the user WITHOUT any <tool> tags.
- You can use multiple tools in one response if needed.
- Do NOT make up information. If you need current data, use a tool."""
    }

    private fun formatMessages(messages: List<ChatMessage>): String {
        val sb = StringBuilder()
        for (msg in messages) {
            when (msg.role) {
                "system" -> {}
                "user" -> sb.append("User: ${msg.content}\n")
                "assistant" -> sb.append("Assistant: ${msg.content}\n")
                "tool" -> sb.append("${msg.content}\n")
            }
        }
        sb.append("Assistant:")
        return sb.toString()
    }

    private fun parseToolCalls(text: String): List<ToolCall> {
        return TOOL_REGEX.findAll(text).map { match ->
            ToolCall(match.groupValues[1], match.groupValues[2].trim())
        }.toList()
    }
}
