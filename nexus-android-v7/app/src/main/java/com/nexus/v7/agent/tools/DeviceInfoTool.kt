package com.nexus.v7.agent.tools

import android.app.ActivityManager
import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.nexus.v7.agent.Tool

class DeviceInfoTool(private val context: Context) : Tool {
    override val name = "device_info"
    override val description = "Get device hardware and status info. Usage: device_info()"

    override suspend fun execute(args: String): String {
        val actManager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        actManager.getMemoryInfo(memInfo)

        val batteryManager = context.getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        val batteryLevel = batteryManager?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1

        val stat = StatFs(Environment.getDataDirectory().path)
        val availGB = stat.availableBytes / (1024L * 1024L * 1024L)
        val totalGB = stat.totalBytes / (1024L * 1024L * 1024L)

        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val network = cm?.activeNetwork
        val caps = network?.let { cm.getNetworkCapabilities(it) }
        val networkType = when {
            caps == null -> "No network"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "WiFi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Cellular"
            else -> "Other"
        }

        val ramAvailMB = memInfo.availMem / (1024 * 1024)
        val ramTotalMB = memInfo.totalMem / (1024 * 1024)

        return buildString {
            appendLine("Device: ${Build.MANUFACTURER} ${Build.MODEL}")
            appendLine("Android: ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("CPU: ${Runtime.getRuntime().availableProcessors()} cores")
            appendLine("RAM: ${ramAvailMB}MB free / ${ramTotalMB}MB total")
            appendLine("Storage: ${availGB}GB free / ${totalGB}GB total")
            appendLine("Battery: $batteryLevel%")
            appendLine("Network: $networkType")
            append("ABI: ${Build.SUPPORTED_ABIS.joinToString(", ")}")
        }
    }
}
