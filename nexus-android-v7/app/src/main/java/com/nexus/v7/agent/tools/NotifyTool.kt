package com.nexus.v7.agent.tools

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat
import com.nexus.v7.agent.Tool

class NotifyTool(private val context: Context) : Tool {
    override val name = "send_notification"
    override val description = "Send a device notification. Usage: send_notification(title|message)"

    override suspend fun execute(args: String): String {
        val parts = args.split("|", limit = 2)
        val title = parts[0].trim()
        val message = if (parts.size > 1) parts[1].trim() else title

        val channelId = "nexus_agent"
        val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(channelId, "Nexus Agent", NotificationManager.IMPORTANCE_DEFAULT)
            notificationManager.createNotificationChannel(channel)
        }

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(title)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        notificationManager.notify(System.currentTimeMillis().toInt(), notification)
        return "Notification sent: $title"
    }
}
