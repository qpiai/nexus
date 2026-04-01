package com.nexus.v7

import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.graphics.LinearGradient
import android.graphics.Shader
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.StatFs
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.cardview.widget.CardView
import androidx.core.content.ContextCompat
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.nexus.v7.api.DeviceHardware
import com.nexus.v7.api.ModelInfo
import com.nexus.v7.api.NexusApiClient
import com.nexus.v7.api.VisionModelInfo
import com.nexus.v7.models.MobileModel
import com.nexus.v7.models.ModelDownloadManager
import com.nexus.v7.vision.VisionActivity
import kotlinx.coroutines.*
import java.io.RandomAccessFile
import java.util.*

class MainActivity : AppCompatActivity() {
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private lateinit var apiClient: NexusApiClient
    private lateinit var prefs: SharedPreferences
    private lateinit var downloadManager: ModelDownloadManager
    private val gson = Gson()

    // UI elements
    private lateinit var statusBadge: TextView
    private lateinit var statusDot: View
    private lateinit var deviceInfoText: TextView
    private lateinit var logText: TextView
    private lateinit var logScroll: ScrollView
    private lateinit var modelsContainer: LinearLayout
    private lateinit var modelsSection: View
    private lateinit var refreshModelsBtn: Button
    private lateinit var modeOnDeviceBtn: Button
    private lateinit var modeServerBtn: Button
    private lateinit var storageText: TextView
    private lateinit var ramText: TextView
    private lateinit var visionModelsContainer: LinearLayout
    private lateinit var userGreeting: TextView

    private var deviceId: String? = null
    private var isConnected = false
    private var currentModels: List<ModelInfo> = emptyList()
    private var currentMobileModels: List<MobileModel> = emptyList()
    private var currentVisionModels: List<VisionModelInfo> = emptyList()

    private var inferenceMode = "on_device"
    private var lastTokPerSec: Double = 0.0
    private var activeModelName: String? = null
    private val downloadJobs = mutableMapOf<String, Job>()
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var isNetworkAvailable = true

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("nexus_v7", Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", "") ?: ""
        apiClient = NexusApiClient(serverUrl)
        val authToken = prefs.getString("auth_token", null)
        if (authToken != null) apiClient.setAuthToken(authToken)
        downloadManager = ModelDownloadManager(this)
        downloadManager.authToken = authToken
        buildUI()
        displayDeviceInfo()
        registerNetworkCallback()

        if (!NexusApiClient.isNetworkAvailable(this)) {
            isNetworkAvailable = false
            log("Starting in offline mode")
            setInferenceMode("on_device")
            setConnectionStatus(false)
            loadLocalModels()
        } else {
            val savedMode = prefs.getString("inference_mode", "on_device") ?: "on_device"
            if (savedMode != "on_device") setInferenceMode(savedMode)
            if (inferenceMode == "on_device") loadLocalModels()
            if (serverUrl.isNotEmpty()) connectToServer()
        }
    }

    private fun buildUI() {
        val root = ScrollView(this).apply {
            setBackgroundColor(0xFF080A12.toInt()); isVerticalScrollBarEnabled = false
        }
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(12), dp(16), dp(24))
        }

        // ── HERO HEADER ──
        val heroCard = FrameLayout(this).apply {
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.hero_card_bg)
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) }
        }
        val heroContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(20), dp(20), dp(20), dp(20))
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        val titleLogo = ImageView(this).apply {
            setImageResource(R.drawable.qpiai_logo); scaleType = ImageView.ScaleType.FIT_CENTER
            val size = dp(44)
            layoutParams = LinearLayout.LayoutParams(size, size).apply { marginEnd = dp(12) }
        }
        val titleCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val titleText = TextView(this).apply {
            text = "QpiAI Nexus v7"; textSize = 22f; setTextColor(0xFFF0F0F5.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD); letterSpacing = -0.02f
        }
        titleText.post {
            val w = titleText.paint.measureText(titleText.text.toString())
            titleText.paint.shader = LinearGradient(0f, 0f, w, 0f,
                intArrayOf(0xFFF0F0F5.toInt(), 0xFF7B9FC7.toInt(), 0xFFD63384.toInt()),
                floatArrayOf(0f, 0.6f, 1f), Shader.TileMode.CLAMP)
            titleText.invalidate()
        }
        val subtitleText = TextView(this).apply {
            text = "VLM Chat + Agent + Vision AI"
            textSize = 11f; setTextColor(0xFF8B8B9E.toInt()); letterSpacing = 0.02f
        }
        titleCol.addView(titleText); titleCol.addView(subtitleText)

        val statusPill = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.stat_chip_bg)
            setPadding(dp(10), dp(5), dp(10), dp(5))
        }
        statusDot = View(this).apply {
            val size = dp(7); layoutParams = LinearLayout.LayoutParams(size, size).apply { marginEnd = dp(5) }
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.status_dot)
        }
        statusBadge = TextView(this).apply {
            text = "Offline"; textSize = 11f; setTextColor(0xFF8B8B9E.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        statusPill.addView(statusDot); statusPill.addView(statusBadge)
        topRow.addView(titleLogo); topRow.addView(titleCol); topRow.addView(statusPill)
        heroContent.addView(topRow)

        // User greeting + logout
        val userRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, 0)
        }
        val userName = prefs.getString("user_name", null)
        userGreeting = TextView(this).apply {
            text = if (userName != null) "Welcome, $userName" else "Offline Mode"
            textSize = 13f; setTextColor(0xFF7B9FC7.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        userRow.addView(userGreeting)
        if (userName != null) {
            userRow.addView(Button(this).apply {
                text = "Logout"; textSize = 11f; setTextColor(0xFFF87171.toInt())
                setBackgroundColor(0x00000000); isAllCaps = false
                setPadding(dp(8), dp(4), dp(8), dp(4))
                setOnClickListener { logout() }
            })
        }
        heroContent.addView(userRow)

        val badgeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, 0)
        }
        badgeRow.addView(TextView(this).apply {
            text = "  JNI Engine"; textSize = 10f; setTextColor(0xFF34D399.toInt())
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.badge_jni_bg)
            setPadding(dp(8), dp(3), dp(10), dp(3)); setTypeface(null, android.graphics.Typeface.BOLD)
        })
        badgeRow.addView(TextView(this).apply {
            text = "  VLM"; textSize = 10f; setTextColor(0xFFFFFFFF.toInt())
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.badge_vlm_bg)
            setPadding(dp(8), dp(3), dp(10), dp(3)); setTypeface(null, android.graphics.Typeface.BOLD)
        })
        badgeRow.addView(TextView(this).apply {
            text = "  Agent"; textSize = 10f; setTextColor(0xFFFBBF24.toInt())
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.badge_agent_bg)
            setPadding(dp(8), dp(3), dp(10), dp(3)); setTypeface(null, android.graphics.Typeface.BOLD)
        })
        badgeRow.addView(TextView(this).apply {
            text = "  Vision AI"; textSize = 10f; setTextColor(0xFFD63384.toInt())
            setPadding(dp(6), dp(3), dp(8), dp(3))
        })
        heroContent.addView(badgeRow); heroCard.addView(heroContent); container.addView(heroCard)

        // ── QUICK STATS BAR ──
        val statsRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) }
        }
        storageText = createStatChip("\uD83D\uDCBE", "Storage", "...")
        ramText = createStatChip("\uD83E\uDDE0", "RAM", "...")
        statsRow.addView(storageText, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(8) })
        statsRow.addView(ramText, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        container.addView(statsRow)

        // ── INFERENCE MODE TOGGLE ──
        val modeCard = createCard()
        val modeContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        modeContent.addView(createSectionHeader("\u26A1", "Inference Mode"))
        val modeToggle = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.mode_toggle_bg)
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }
        modeOnDeviceBtn = Button(this).apply {
            text = "On-Device"; textSize = 13f; setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(0xFFFFFFFF.toInt())
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.mode_toggle_active)
            setPadding(dp(16), dp(10), dp(16), dp(10)); isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { setInferenceMode("on_device") }
        }
        modeServerBtn = Button(this).apply {
            text = "Cloud"; textSize = 13f; setTextColor(0xFF8B8B9E.toInt())
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.mode_toggle_inactive)
            setPadding(dp(16), dp(10), dp(16), dp(10)); isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { setInferenceMode("server") }
        }
        modeToggle.addView(modeOnDeviceBtn); modeToggle.addView(modeServerBtn)
        modeContent.addView(modeToggle)
        modeContent.addView(TextView(this).apply {
            text = "On-Device runs AI directly on your phone via JNI\nCloud mode uses the server for heavy inference"
            textSize = 11f; setTextColor(0xFF6B6B7E.toInt()); setPadding(0, dp(10), 0, 0)
            setLineSpacing(dp(2).toFloat(), 1f)
        })
        modeCard.addView(modeContent); container.addView(modeCard)

        updateStorageStatus()

        // ── VISION BUTTON ──
        container.addView(Button(this).apply {
            text = "\uD83D\uDC41\uFE0F  Vision — Detection & Segmentation"
            textSize = 14f; setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFF8b5cf6.toInt())
            setPadding(dp(16), dp(14), dp(16), dp(14)); isAllCaps = false
            setTypeface(null, android.graphics.Typeface.BOLD)
            setOnClickListener { VisionActivity.launch(this@MainActivity) }
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(16) }
        })

        // ── AVAILABLE MODELS (LLM) ──
        val modelsCard = createCard()
        modelsSection = modelsCard
        val modelsContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        val modelsHeader = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        modelsHeader.addView(createSectionHeader("\uD83D\uDE80", "LLM Models"), LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        refreshModelsBtn = Button(this).apply {
            text = "\u21BB  Refresh"; textSize = 11f; setTextColor(0xFF7B9FC7.toInt())
            setBackgroundColor(0x00000000); isAllCaps = false; setOnClickListener { loadModels() }
        }
        modelsHeader.addView(refreshModelsBtn)
        modelsContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        modelsContainer.addView(createEmptyState("No models yet", "Download models from the server, or connect to discover new ones"))
        modelsContent.addView(modelsHeader); modelsContent.addView(modelsContainer)
        modelsCard.addView(modelsContent); container.addView(modelsCard)

        // ── VISION MODELS SECTION ──
        val visionCard = createCard()
        val visionContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        visionContent.addView(createSectionHeader("\uD83D\uDC41\uFE0F", "Vision Models"))
        visionModelsContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        visionModelsContainer.addView(TextView(this).apply {
            text = "Connect to server to see vision models"
            textSize = 11f; setTextColor(0xFF6B6B7E.toInt()); gravity = Gravity.CENTER
            setPadding(0, dp(12), 0, dp(12))
        })
        visionContent.addView(visionModelsContainer)
        visionCard.addView(visionContent); container.addView(visionCard)

        // ── DEVICE INFO ──
        val deviceCard = createCard()
        val deviceContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        deviceContent.addView(createSectionHeader("\uD83D\uDCF1", "Device"))
        deviceInfoText = TextView(this).apply {
            textSize = 12f; setTextColor(0xFF8B8B9E.toInt()); setLineSpacing(dp(3).toFloat(), 1f)
        }
        deviceContent.addView(deviceInfoText); deviceCard.addView(deviceContent); container.addView(deviceCard)

        // ── CONNECTION LOG ──
        val logCard = createCard()
        val logContent = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(18), dp(18), dp(18))
        }
        logContent.addView(createSectionHeader("\uD83D\uDCCB", "Log"))
        logScroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(160))
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.log_bg)
            setPadding(dp(10), dp(10), dp(10), dp(10))
        }
        logText = TextView(this).apply {
            text = "Ready...\n"; textSize = 10f; setTextColor(0xFF34D399.toInt())
            setTypeface(android.graphics.Typeface.MONOSPACE); setLineSpacing(dp(1).toFloat(), 1f)
        }
        logScroll.addView(logText); logContent.addView(logScroll)
        logCard.addView(logContent); container.addView(logCard)

        root.addView(container)
        setContentView(root)
    }

    // ── UI Helpers ──

    private fun createCard(): CardView = CardView(this).apply {
        radius = dp(16).toFloat(); cardElevation = 0f; setCardBackgroundColor(0xFF0C0E1A.toInt())
        layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(12) }
    }

    private fun createSectionHeader(emoji: String, title: String): TextView = TextView(this).apply {
        text = "$emoji  $title"; textSize = 15f; setTextColor(0xFFF0F0F5.toInt())
        setTypeface(null, android.graphics.Typeface.BOLD); setPadding(0, 0, 0, dp(10)); letterSpacing = -0.01f
    }

    private fun createStatChip(emoji: String, label: String, value: String): TextView = TextView(this).apply {
        text = "$emoji $label\n$value"; textSize = 11f; setTextColor(0xFF8B8B9E.toInt())
        gravity = Gravity.CENTER
        background = ContextCompat.getDrawable(this@MainActivity, R.drawable.stat_chip_bg)
        setPadding(dp(12), dp(10), dp(12), dp(10))
    }

    private fun createEmptyState(title: String, subtitle: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER
        setPadding(dp(16), dp(24), dp(16), dp(24))
        addView(TextView(this@MainActivity).apply { text = "\uD83E\uDD16"; textSize = 28f; gravity = Gravity.CENTER; setPadding(0, 0, 0, dp(8)) })
        addView(TextView(this@MainActivity).apply { text = title; textSize = 14f; setTextColor(0xFF8B8B9E.toInt()); gravity = Gravity.CENTER; setTypeface(null, android.graphics.Typeface.BOLD) })
        addView(TextView(this@MainActivity).apply { text = subtitle; textSize = 11f; setTextColor(0xFF6B6B7E.toInt()); gravity = Gravity.CENTER; setPadding(0, dp(4), 0, 0) })
    }

    // ── Logout ──

    private fun logout() {
        prefs.edit()
            .remove("auth_token")
            .remove("user_name")
            .remove("user_email")
            .remove("user_role")
            .remove("device_id")
            .apply()
        apiClient.disconnectSSE()
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    private fun displayDeviceInfo() {
        val hw = getDeviceHardware()
        deviceInfoText.text = buildString {
            appendLine("\u2022  ${hw.name}"); appendLine("\u2022  ${hw.platform}")
            appendLine("\u2022  ${hw.cpuModel} \u2022 ${hw.cpuCores} cores")
            appendLine("\u2022  ${hw.ramGB} GB RAM \u2022 ${hw.storageGB} GB Storage")
            append("\u2022  ${Build.SUPPORTED_ABIS.joinToString(", ")}")
        }
    }

    private fun getDeviceHardware(): DeviceHardware {
        val actManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo(); actManager.getMemoryInfo(memInfo)
        val ramGB = (memInfo.totalMem / (1024L * 1024L * 1024L)).toInt()
        val stat = StatFs(Environment.getDataDirectory().path)
        val storageGB = (stat.totalBytes / (1024L * 1024L * 1024L)).toInt()
        val cpuCores = Runtime.getRuntime().availableProcessors()
        val cpuModel = try {
            RandomAccessFile("/proc/cpuinfo", "r").use { reader ->
                var line = reader.readLine()
                while (line != null) {
                    if (line.startsWith("Hardware") || line.startsWith("model name"))
                        return@use line.split(":").lastOrNull()?.trim() ?: Build.HARDWARE
                    line = reader.readLine()
                }
                Build.HARDWARE
            }
        } catch (e: Exception) { Build.HARDWARE }
        return DeviceHardware("${Build.MANUFACTURER} ${Build.MODEL}", "Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})", cpuModel, cpuCores, ramGB, storageGB)
    }

    // ── Connection ──

    private fun connectToServer() {
        val serverUrl = prefs.getString("server_url", "") ?: ""
        if (serverUrl.isEmpty()) return
        log("Connecting to $serverUrl ...")

        scope.launch {
            try {
                val hw = getDeviceHardware()
                val savedDeviceId = prefs.getString("device_id", null)
                log("Registering device: ${hw.name}")
                val result = try {
                    apiClient.registerDevice(hw, savedDeviceId)
                } catch (e: Exception) {
                    if (e.message?.contains("401") == true) {
                        log("Auth expired — please login again")
                        return@launch
                    }
                    throw e
                }
                deviceId = result.id
                prefs.edit().putString("device_id", result.id).apply()
                if (result.token != null) {
                    prefs.edit().putString("device_token", result.token).apply()
                    apiClient.setAuthToken(result.token)
                }
                downloadManager.authToken = apiClient.getAuthToken()
                log("Registered! Device ID: ${result.id}")

                log("Opening SSE connection...")
                apiClient.connectSSE(result.id, object : NexusApiClient.SSEListener {
                    override fun onConnected() { runOnUiThread { setConnectionStatus(true); log("SSE connected") } }
                    override fun onDisconnected() { runOnUiThread { setConnectionStatus(false); log("SSE disconnected") } }
                    override fun onEvent(type: String, data: String) {
                        runOnUiThread { log("Event [$type]: $data"); if (type == "deploy") handleDeployEvent(data) }
                    }
                    override fun onError(message: String) { runOnUiThread { log("SSE error: $message") } }
                })
                startMetricsReporting()
                loadModels()
                loadVisionModels()
            } catch (e: Exception) {
                log("Error: ${e.message}"); setConnectionStatus(false)
            }
        }
    }

    private fun handleDeployEvent(data: String) {
        try {
            val json = gson.fromJson(data, JsonObject::class.java)
            val model = json.get("model")?.asString ?: return
            Toast.makeText(this, "Server push: downloading $model", Toast.LENGTH_SHORT).show()
            log(">> Deploy event: downloading $model"); startModelDownload(model)
        } catch (e: Exception) { log("Failed to parse deploy event: ${e.message}") }
    }

    // ── Inference Mode ──

    private fun setInferenceMode(mode: String) {
        inferenceMode = mode; prefs.edit().putString("inference_mode", mode).apply()
        if (mode == "on_device") {
            modeOnDeviceBtn.background = ContextCompat.getDrawable(this, R.drawable.mode_toggle_active)
            modeOnDeviceBtn.setTextColor(0xFFFFFFFF.toInt()); modeOnDeviceBtn.setTypeface(null, android.graphics.Typeface.BOLD)
            modeServerBtn.background = ContextCompat.getDrawable(this, R.drawable.mode_toggle_inactive)
            modeServerBtn.setTextColor(0xFF8B8B9E.toInt()); modeServerBtn.setTypeface(null, android.graphics.Typeface.NORMAL)
        } else {
            modeServerBtn.background = ContextCompat.getDrawable(this, R.drawable.mode_toggle_active)
            modeServerBtn.setTextColor(0xFFFFFFFF.toInt()); modeServerBtn.setTypeface(null, android.graphics.Typeface.BOLD)
            modeOnDeviceBtn.background = ContextCompat.getDrawable(this, R.drawable.mode_toggle_inactive)
            modeOnDeviceBtn.setTextColor(0xFF8B8B9E.toInt()); modeOnDeviceBtn.setTypeface(null, android.graphics.Typeface.NORMAL)
        }
        if (mode == "on_device") {
            if (currentMobileModels.isNotEmpty()) displayMobileModels(currentMobileModels) else loadModels()
        } else {
            if (currentModels.isNotEmpty()) displayModels(currentModels) else loadModels()
        }
    }

    private fun updateStorageStatus() {
        val availStorageMB = downloadManager.getAvailableSpaceMB()
        val storageGB = String.format("%.1f", availStorageMB / 1024.0)
        storageText.text = "\uD83D\uDCBE Storage\n${storageGB} GB free"
        val actManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo(); actManager.getMemoryInfo(memInfo)
        val availRamMB = memInfo.availMem / (1024 * 1024)
        val totalRamMB = memInfo.totalMem / (1024 * 1024)
        ramText.text = "\uD83E\uDDE0 RAM\n${String.format("%.1f", availRamMB / 1024.0)} / ${String.format("%.1f", totalRamMB / 1024.0)} GB"
    }

    // ── LLM Models ──

    private fun loadModels() {
        scope.launch {
            try {
                log("Fetching available models...")
                if (inferenceMode == "on_device") {
                    val serverUrl = prefs.getString("server_url", "") ?: ""
                    if (serverUrl.isEmpty()) { log("No server URL — showing local models only"); loadLocalModels(); return@launch }
                    val result = downloadManager.fetchServerModels(serverUrl)
                    result.fold(
                        onSuccess = { serverModels ->
                            log("Found ${serverModels.size} mobile models")
                            val serverFiles = serverModels.map { it.file }.toSet()
                            val localOnly = buildLocalModels().filter { it.file !in serverFiles }
                            val merged = serverModels + localOnly
                            currentMobileModels = merged; displayMobileModels(merged)
                        },
                        onFailure = { e ->
                            log("Failed to fetch mobile models: ${e.message}")
                            try {
                                val models = apiClient.getModels()
                                log("Fallback: found ${models.size} models"); currentModels = models; displayModels(models)
                            } catch (e2: Exception) { log("Fallback also failed: ${e2.message}"); loadLocalModels() }
                        }
                    )
                } else {
                    val models = apiClient.getModels()
                    log("Found ${models.size} server models"); currentModels = models; displayModels(models)
                }
                updateStorageStatus()
            } catch (e: Exception) { log("Failed to load models: ${e.message}") }
        }
    }

    private fun loadLocalModels() {
        val localModels = buildLocalModels()
        if (localModels.isNotEmpty()) { log("Found ${localModels.size} local model(s)"); currentMobileModels = localModels; displayMobileModels(localModels) }
        else { log("No local models found"); displayMobileModels(emptyList()) }
        updateStorageStatus()
    }

    private fun buildLocalModels(): List<MobileModel> {
        return downloadManager.getDownloadedModelFiles().map { (filename, file) ->
            val sizeMB = (file.length() / (1024 * 1024)).toInt()
            val quant = extractQuantization(filename)
            val displayName = filename.removeSuffix(".gguf").replace("-", " ").replace("_", " ")
                .split(" ").joinToString(" ") { word ->
                    if (word.all { it.isUpperCase() || it.isDigit() }) word else word.replaceFirstChar { it.uppercase() }
                }
            MobileModel(id = "local_$filename", name = displayName, file = filename, sizeBytes = file.length(),
                sizeMB = sizeMB, quantization = quant, method = "GGUF", downloadUrl = "",
                recommendedRamGB = (sizeMB / 512).coerceAtLeast(2), mobileCompatible = sizeMB < 4096)
        }
    }

    private fun extractQuantization(filename: String): String {
        val lower = filename.lowercase()
        val patterns = listOf("q2_k","q3_k_s","q3_k_m","q3_k_l","q4_0","q4_1","q4_k_s","q4_k_m","q5_0","q5_1","q5_k_s","q5_k_m","q6_k","q8_0","f16","f32")
        return patterns.firstOrNull { lower.contains(it) }?.uppercase() ?: "GGUF"
    }

    private fun displayModels(models: List<ModelInfo>) {
        modelsContainer.removeAllViews()
        if (models.isEmpty()) { modelsContainer.addView(createEmptyState("No models found", "Quantize a model on the server first")); return }
        for ((i, model) in models.withIndex()) {
            val row = createModelRow(model)
            row.alpha = 0f; row.animate().alpha(1f).setStartDelay((i * 60).toLong()).setDuration(300).start()
            modelsContainer.addView(row)
        }
    }

    private fun displayMobileModels(models: List<MobileModel>) {
        modelsContainer.removeAllViews()
        if (models.isEmpty()) { modelsContainer.addView(createEmptyState("No GGUF models available", "Quantize a model in GGUF format on the server")); return }
        for ((i, model) in models.withIndex()) {
            val row = createMobileModelRow(model)
            row.alpha = 0f; row.animate().alpha(1f).setStartDelay((i * 60).toLong()).setDuration(300).start()
            modelsContainer.addView(row)
        }
    }

    private fun createMobileModelRow(model: MobileModel): View {
        val outerContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.model_row_bg)
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        val nameRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        nameRow.addView(TextView(this).apply {
            text = model.name; textSize = 13f; setTextColor(0xFFF0F0F5.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD); isSingleLine = true
        })
        if (model.isVLM) {
            nameRow.addView(TextView(this).apply {
                text = "VLM"; textSize = 9f; setTextColor(0xFFFFFFFF.toInt())
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.badge_vlm_bg)
                setPadding(dp(5), dp(1), dp(5), dp(1))
                setTypeface(null, android.graphics.Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(6) }
            })
        }
        info.addView(nameRow)
        val subtitleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(3), 0, 0)
        }
        subtitleRow.addView(TextView(this).apply {
            text = model.quantization; textSize = 10f; setTextColor(0xFF34D399.toInt())
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.badge_jni_bg)
            setPadding(dp(6), dp(1), dp(6), dp(1))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(6) }
        })
        subtitleRow.addView(TextView(this).apply {
            text = "${model.sizeMB} MB  \u2022  RAM ${model.recommendedRamGB} GB"; textSize = 10f
            setTextColor(if (model.mobileCompatible) 0xFF8B8B9E.toInt() else 0xFFFBBF24.toInt())
        })
        info.addView(subtitleRow); row.addView(info)

        val isDownloaded = downloadManager.isModelDownloaded(model.file)
        val buttonsContainer = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
        }
        if (isDownloaded) {
            buttonsContainer.addView(Button(this).apply {
                text = "Chat \u2192"; textSize = 12f; setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(0xFFFFFFFF.toInt())
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.btn_chat_bg)
                setPadding(dp(14), dp(7), dp(14), dp(7)); isAllCaps = false
                setOnClickListener { launchOnDeviceChat(model) }
            })
            buttonsContainer.addView(Button(this).apply {
                text = "\u2717"; textSize = 16f; setTextColor(0xFFF87171.toInt()); setBackgroundColor(0x00000000)
                setPadding(dp(10), dp(4), dp(4), dp(4))
                setOnClickListener {
                    downloadManager.deleteModel(model.file); log("Deleted: ${model.file}")
                    displayMobileModels(currentMobileModels); updateStorageStatus()
                }
            })
        } else {
            if (!model.mobileCompatible) buttonsContainer.addView(TextView(this).apply { text = "\u26A0"; textSize = 14f; setPadding(0, 0, dp(6), 0) })
            buttonsContainer.addView(Button(this).apply {
                text = "Get"; textSize = 12f; setTypeface(null, android.graphics.Typeface.BOLD)
                setTextColor(0xFFFFFFFF.toInt())
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.btn_download_bg)
                setPadding(dp(16), dp(7), dp(16), dp(7)); isAllCaps = false
                tag = "dl_btn_${model.file}"; setOnClickListener { startModelDownload(model.file) }
            })
        }
        row.addView(buttonsContainer); outerContainer.addView(row)
        if (!isDownloaded) {
            outerContainer.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = 100; progress = 0; visibility = View.GONE; tag = "progress_${model.file}"
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(3)).apply { topMargin = dp(2); marginStart = dp(14); marginEnd = dp(14) }
            })
            outerContainer.addView(TextView(this).apply {
                text = ""; textSize = 10f; setTextColor(0xFF8B8B9E.toInt()); visibility = View.GONE
                tag = "progress_text_${model.file}"; setPadding(dp(14), dp(2), dp(14), 0)
            })
        }
        return outerContainer
    }

    private fun launchOnDeviceChat(model: MobileModel) {
        val modelFile = downloadManager.getModelFile(model.file)
        if (!modelFile.exists()) { log("Model file not found: ${model.file}"); return }
        startActivity(Intent(this, ChatActivity::class.java).apply {
            putExtra(ChatActivity.EXTRA_MODEL_PATH, modelFile.absolutePath)
            putExtra(ChatActivity.EXTRA_MODEL_NAME, model.name)
            putExtra(ChatActivity.EXTRA_INFERENCE_MODE, ChatActivity.MODE_ON_DEVICE)
            putExtra(ChatActivity.EXTRA_AUTH_TOKEN, apiClient.getAuthToken())
            putExtra(ChatActivity.EXTRA_IS_VLM, model.isVLM)
        })
    }

    private fun createModelRow(model: ModelInfo): View {
        val outerContainer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) }
        }
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.model_row_bg)
            setPadding(dp(14), dp(12), dp(14), dp(12))
        }
        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        info.addView(TextView(this).apply {
            text = model.name; textSize = 13f; setTextColor(0xFFF0F0F5.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD); isSingleLine = true
        })
        val subtitleRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(3), 0, 0)
        }
        subtitleRow.addView(TextView(this).apply {
            text = model.method; textSize = 10f; setTextColor(0xFF34D399.toInt())
            background = ContextCompat.getDrawable(this@MainActivity, R.drawable.badge_jni_bg)
            setPadding(dp(6), dp(1), dp(6), dp(1))
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(6) }
        })
        subtitleRow.addView(TextView(this).apply { text = "${model.sizeMB} MB"; textSize = 10f; setTextColor(0xFF8B8B9E.toInt()) })
        info.addView(subtitleRow); row.addView(info)
        val isGGUF = model.method == "GGUF"
        val isDownloaded = isGGUF && downloadManager.isModelDownloaded(model.file)
        if (inferenceMode == "server") {
            if (isGGUF) {
                row.addView(Button(this).apply {
                    text = "Chat \u2192"; textSize = 12f; setTypeface(null, android.graphics.Typeface.BOLD)
                    setTextColor(0xFFFFFFFF.toInt())
                    background = ContextCompat.getDrawable(this@MainActivity, R.drawable.btn_chat_bg)
                    setPadding(dp(14), dp(7), dp(14), dp(7)); isAllCaps = false
                    setOnClickListener { launchChat(model) }
                })
            }
        } else if (isGGUF) {
            if (isDownloaded) {
                row.addView(Button(this).apply {
                    text = "Chat \u2192"; textSize = 12f; setTypeface(null, android.graphics.Typeface.BOLD)
                    setTextColor(0xFFFFFFFF.toInt())
                    background = ContextCompat.getDrawable(this@MainActivity, R.drawable.btn_chat_bg)
                    setPadding(dp(14), dp(7), dp(14), dp(7)); isAllCaps = false
                    setOnClickListener { launchChat(model) }
                })
            } else {
                row.addView(Button(this).apply {
                    text = "Get"; textSize = 12f; setTypeface(null, android.graphics.Typeface.BOLD)
                    setTextColor(0xFFFFFFFF.toInt())
                    background = ContextCompat.getDrawable(this@MainActivity, R.drawable.btn_download_bg)
                    setPadding(dp(16), dp(7), dp(16), dp(7)); isAllCaps = false
                    tag = "dl_btn_${model.file}"; setOnClickListener { startModelDownload(model.file) }
                })
            }
        }
        outerContainer.addView(row)
        if (isGGUF && !isDownloaded) {
            outerContainer.addView(ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
                max = 100; progress = 0; visibility = View.GONE; tag = "progress_${model.file}"
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(3)).apply { topMargin = dp(2); marginStart = dp(14); marginEnd = dp(14) }
            })
            outerContainer.addView(TextView(this).apply {
                text = ""; textSize = 10f; setTextColor(0xFF8B8B9E.toInt()); visibility = View.GONE
                tag = "progress_text_${model.file}"; setPadding(dp(14), dp(2), dp(14), 0)
            })
        }
        return outerContainer
    }

    private fun startModelDownload(filename: String) {
        if (downloadJobs.containsKey(filename)) { log("Download already in progress: $filename"); return }
        val serverUrl = prefs.getString("server_url", "") ?: ""
        if (serverUrl.isEmpty()) { log("Error: No server URL configured"); return }
        log("Starting download: $filename")
        val progressBar = findViewByTag<ProgressBar>("progress_$filename")
        val progressText = findViewByTag<TextView>("progress_text_$filename")
        val dlBtn = findViewByTag<Button>("dl_btn_$filename")
        progressBar?.visibility = View.VISIBLE; progressText?.visibility = View.VISIBLE
        dlBtn?.isEnabled = false; dlBtn?.text = "..."
        val job = scope.launch {
            val result = downloadManager.downloadModel(serverUrl, filename) { downloaded, total ->
                runOnUiThread {
                    if (total > 0) {
                        val pct = ((downloaded * 100) / total).toInt(); progressBar?.progress = pct
                        progressText?.text = "${downloaded / (1024*1024)}MB / ${total / (1024*1024)}MB  ($pct%)"
                    }
                }
            }
            downloadJobs.remove(filename)
            result.fold(
                onSuccess = { log("Download complete: $filename"); runOnUiThread {
                    if (inferenceMode == "on_device" && currentMobileModels.isNotEmpty()) displayMobileModels(currentMobileModels)
                    else displayModels(currentModels); updateStorageStatus()
                } },
                onFailure = { e -> log("Download failed: ${e.message}"); runOnUiThread {
                    progressBar?.visibility = View.GONE; progressText?.visibility = View.GONE
                    dlBtn?.isEnabled = true; dlBtn?.text = "Retry"
                } }
            )
        }
        downloadJobs[filename] = job
    }

    @Suppress("UNCHECKED_CAST")
    private fun <T : View> findViewByTag(tag: String): T? = findViewWithTag(modelsContainer, tag) as? T
    private fun findViewWithTag(root: View, tag: String): View? {
        if (root.tag == tag) return root
        if (root is android.view.ViewGroup) { for (i in 0 until root.childCount) { findViewWithTag(root.getChildAt(i), tag)?.let { return it } } }
        return null
    }

    private fun launchChat(model: ModelInfo) {
        if (inferenceMode == "server") {
            val serverUrl = prefs.getString("server_url", "") ?: ""; if (serverUrl.isEmpty()) { log("Error: No server URL configured"); return }
            startActivity(Intent(this, ChatActivity::class.java).apply {
                putExtra(ChatActivity.EXTRA_MODEL_NAME, model.name); putExtra(ChatActivity.EXTRA_INFERENCE_MODE, ChatActivity.MODE_SERVER)
                putExtra(ChatActivity.EXTRA_SERVER_URL, serverUrl); putExtra(ChatActivity.EXTRA_MODEL_FILE, model.file)
                putExtra(ChatActivity.EXTRA_MODEL_METHOD, model.method); putExtra(ChatActivity.EXTRA_AUTH_TOKEN, apiClient.getAuthToken())
            })
        } else {
            val modelFile = downloadManager.getModelFile(model.file)
            if (!modelFile.exists()) { log("Model file not found: ${model.file}"); return }
            startActivity(Intent(this, ChatActivity::class.java).apply {
                putExtra(ChatActivity.EXTRA_MODEL_PATH, modelFile.absolutePath); putExtra(ChatActivity.EXTRA_MODEL_NAME, model.name)
                putExtra(ChatActivity.EXTRA_INFERENCE_MODE, ChatActivity.MODE_ON_DEVICE); putExtra(ChatActivity.EXTRA_AUTH_TOKEN, apiClient.getAuthToken())
            })
        }
    }

    // ── Vision Models ──

    private fun loadVisionModels() {
        scope.launch {
            try {
                val models = apiClient.getVisionModels()
                currentVisionModels = models
                displayVisionModels(models)
                log("Found ${models.size} vision models")
            } catch (e: Exception) { log("Failed to load vision models: ${e.message}") }
        }
    }

    private fun displayVisionModels(models: List<VisionModelInfo>) {
        visionModelsContainer.removeAllViews()
        if (models.isEmpty()) {
            visionModelsContainer.addView(TextView(this).apply {
                text = "No vision models available"; textSize = 11f; setTextColor(0xFF6B6B7E.toInt())
                gravity = Gravity.CENTER; setPadding(0, dp(12), 0, dp(12))
            })
            return
        }
        for (model in models) {
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.model_row_bg)
                setPadding(dp(12), dp(8), dp(12), dp(8))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(4) }
            }
            val info = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            }
            info.addView(TextView(this).apply { text = model.name; textSize = 11f; setTextColor(0xFFF0F0F5.toInt()); isSingleLine = true })
            val badges = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(2), 0, 0) }
            badges.addView(TextView(this).apply {
                text = model.format; textSize = 9f; setTextColor(0xFF34D399.toInt())
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.badge_jni_bg)
                setPadding(dp(4), dp(1), dp(4), dp(1))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(4) }
            })
            badges.addView(TextView(this).apply {
                text = model.task.replaceFirstChar { it.uppercase() }; textSize = 9f; setTextColor(0xFF06B6D4.toInt())
                background = ContextCompat.getDrawable(this@MainActivity, R.drawable.badge_task_bg)
                setPadding(dp(4), dp(1), dp(4), dp(1))
                layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(4) }
            })
            badges.addView(TextView(this).apply { text = "${model.sizeMB}MB"; textSize = 9f; setTextColor(0xFF8B8B9E.toInt()) })
            info.addView(badges); row.addView(info)
            visionModelsContainer.addView(row)
        }
    }

    // ── System Metrics ──

    private fun getCpuUsage(): Int {
        try {
            val line: String; RandomAccessFile("/proc/stat", "r").use { reader -> line = reader.readLine() }
            val parts = line.split("\\s+".toRegex()); val idle = parts[4].toLong()
            val total = parts.drop(1).take(7).sumOf { it.toLong() }; Thread.sleep(100)
            val line2: String; RandomAccessFile("/proc/stat", "r").use { reader -> line2 = reader.readLine() }
            val parts2 = line2.split("\\s+".toRegex()); val idle2 = parts2[4].toLong()
            val total2 = parts2.drop(1).take(7).sumOf { it.toLong() }
            val idleDiff = idle2 - idle; val totalDiff = total2 - total
            return if (totalDiff > 0) ((totalDiff - idleDiff) * 100 / totalDiff).toInt() else 0
        } catch (e: Exception) { return -1 }
    }

    private fun getBatteryLevel(): Int {
        val bm = getSystemService(Context.BATTERY_SERVICE) as? android.os.BatteryManager
        return bm?.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
    }

    private fun startMetricsReporting() {
        scope.launch {
            while (isActive && isConnected) {
                delay(15000); val id = deviceId ?: continue
                try {
                    val actManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
                    val memInfo = ActivityManager.MemoryInfo(); actManager.getMemoryInfo(memInfo)
                    val memUsage = ((1.0 - memInfo.availMem.toDouble() / memInfo.totalMem) * 100).toInt()
                    val chatPrefs = getSharedPreferences("nexus_chat_metrics_v7", Context.MODE_PRIVATE)
                    apiClient.sendMetrics(id, mapOf(
                        "cpuUsage" to getCpuUsage(), "memoryUsage" to memUsage, "batteryLevel" to getBatteryLevel(),
                        "tokensPerSec" to lastTokPerSec, "activeModel" to (activeModelName ?: ""),
                        "totalInferences" to chatPrefs.getInt("totalInferences", 0),
                        "totalTokens" to chatPrefs.getInt("totalTokens", 0), "engineType" to "JNI"
                    ))
                } catch (_: Exception) {}
            }
        }
    }

    private fun setConnectionStatus(connected: Boolean) {
        isConnected = connected
        if (connected) {
            statusBadge.text = "Online"; statusBadge.setTextColor(0xFF34D399.toInt())
            statusDot.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF34D399.toInt())
        } else if (!isNetworkAvailable) {
            statusBadge.text = "Offline"; statusBadge.setTextColor(0xFFF87171.toInt())
            statusDot.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFFF87171.toInt())
        } else {
            statusBadge.text = "Disconnected"; statusBadge.setTextColor(0xFF8B8B9E.toInt())
            statusDot.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF8B8B9E.toInt())
        }
    }

    private fun log(msg: String) { val time = String.format("%tT", Date()); logText.append("[$time] $msg\n"); logScroll.post { logScroll.fullScroll(ScrollView.FOCUS_DOWN) } }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    // ── Network Monitoring ──

    private fun registerNetworkCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        isNetworkAvailable = NexusApiClient.isNetworkAvailable(this)

        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                runOnUiThread {
                    if (!isNetworkAvailable) {
                        isNetworkAvailable = true
                        log("Network restored")
                        Toast.makeText(this@MainActivity, "Network restored", Toast.LENGTH_SHORT).show()
                        updateConnectionStatusForNetwork()
                    }
                }
            }
            override fun onLost(network: Network) {
                runOnUiThread {
                    isNetworkAvailable = false
                    log("Network lost")
                    updateConnectionStatusForNetwork()
                    if (inferenceMode == "server") {
                        val localModels = buildLocalModels()
                        if (localModels.isNotEmpty()) {
                            log("Auto-switching to on-device mode (${localModels.size} local models)")
                            setInferenceMode("on_device")
                            Toast.makeText(this@MainActivity, "Offline — switched to on-device mode", Toast.LENGTH_LONG).show()
                        }
                    }
                }
            }
        }
        networkCallback = callback
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .build()
        cm.registerNetworkCallback(request, callback)
    }

    private fun unregisterNetworkCallback() {
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        networkCallback?.let { cm?.unregisterNetworkCallback(it) }
    }

    private fun updateConnectionStatusForNetwork() {
        if (!isNetworkAvailable && !isConnected) {
            statusBadge.text = "Offline"; statusBadge.setTextColor(0xFFF87171.toInt())
            statusDot.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFFF87171.toInt())
        } else if (isNetworkAvailable && !isConnected) {
            statusBadge.text = "Disconnected"; statusBadge.setTextColor(0xFF8B8B9E.toInt())
            statusDot.backgroundTintList = android.content.res.ColorStateList.valueOf(0xFF8B8B9E.toInt())
        }
    }

    override fun onResume() {
        super.onResume()
        if (inferenceMode == "on_device" && currentMobileModels.isNotEmpty()) displayMobileModels(currentMobileModels)
        else if (inferenceMode == "server" && currentModels.isNotEmpty()) displayModels(currentModels)
        val chatPrefs = getSharedPreferences("nexus_chat_metrics_v7", Context.MODE_PRIVATE)
        val savedTokPerSec = chatPrefs.getFloat("lastTokPerSec", 0f).toDouble()
        val savedModelName = chatPrefs.getString("activeModelName", null)
        if (savedTokPerSec > 0) lastTokPerSec = savedTokPerSec
        if (!savedModelName.isNullOrEmpty()) activeModelName = savedModelName
        updateStorageStatus()
    }

    override fun onDestroy() {
        super.onDestroy(); unregisterNetworkCallback(); apiClient.disconnectSSE(); downloadJobs.values.forEach { it.cancel() }; scope.cancel()
    }
}
