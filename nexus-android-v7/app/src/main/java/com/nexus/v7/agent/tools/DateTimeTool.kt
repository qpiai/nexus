package com.nexus.v7.agent.tools

import com.nexus.v7.agent.Tool
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter

class DateTimeTool : Tool {
    override val name = "datetime"
    override val description = "Get the current date, time, and timezone. Usage: datetime()"

    override suspend fun execute(args: String): String {
        val now = ZonedDateTime.now()
        return buildString {
            appendLine("Date: ${now.format(DateTimeFormatter.ofPattern("yyyy-MM-dd"))}")
            appendLine("Time: ${now.format(DateTimeFormatter.ofPattern("HH:mm:ss"))}")
            appendLine("Day: ${now.dayOfWeek}")
            append("Timezone: ${now.zone}")
        }
    }
}
