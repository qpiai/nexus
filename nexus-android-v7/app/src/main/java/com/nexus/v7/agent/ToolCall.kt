package com.nexus.v7.agent

data class ToolCall(val name: String, val args: String)

data class ChatMessage(val role: String, val content: String)

sealed class AgentEvent {
    data class Token(val text: String) : AgentEvent()
    data class ToolExecution(val name: String, val args: String) : AgentEvent()
    data class ToolResult(val name: String, val result: String) : AgentEvent()
    data class FinalAnswer(val text: String) : AgentEvent()
    data class Error(val message: String) : AgentEvent()
}
