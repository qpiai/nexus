package com.nexus.v4

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.*
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.cardview.widget.CardView
import androidx.core.content.ContextCompat
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.*
import java.io.File
import java.io.FileOutputStream

class VisionActivity : AppCompatActivity() {

    private lateinit var prefs: SharedPreferences
    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private lateinit var apiClient: NexusApiClient
    private lateinit var downloadManager: ModelDownloadManager

    // Views
    private lateinit var previewView: PreviewView
    private lateinit var imageView: ImageView
    private lateinit var overlayView: DetectionOverlayView
    private lateinit var emptyState: TextView
    private lateinit var detectBtn: Button
    private lateinit var resultText: TextView
    private lateinit var backBtn: ImageButton
    private lateinit var modelsContainer: LinearLayout
    private lateinit var confSlider: SeekBar
    private lateinit var iouSlider: SeekBar
    private lateinit var confLabel: TextView
    private lateinit var iouLabel: TextView
    private lateinit var tabDetect: Button
    private lateinit var tabSegment: Button
    private lateinit var modeOnDevice: Button
    private lateinit var modeServer: Button
    private lateinit var imageContainer: FrameLayout
    private lateinit var annotatedImageView: ImageView

    // State
    private var currentBitmap: Bitmap? = null
    private var cameraActive = false
    private var imageCapture: ImageCapture? = null
    private var cameraExecutor = java.util.concurrent.Executors.newSingleThreadExecutor()
    private val tfliteDetector by lazy { TFLiteDetector(this) }

    private var currentTask = "detect"
    private var inferenceMode = "server"
    private var confThreshold = 0.25f
    private var iouThreshold = 0.45f

    private var visionModels: List<VisionModelInfo> = emptyList()
    private var selectedModelIdx = -1
    private val downloadJobs = mutableMapOf<String, Job>()

    private val cameraPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startCamera()
        else Toast.makeText(this, "Camera permission required", Toast.LENGTH_SHORT).show()
    }

    private val galleryLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.data?.let { uri -> loadImageFromUri(uri) }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = getSharedPreferences("nexus_v4", Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", "") ?: ""
        apiClient = NexusApiClient(serverUrl)
        val savedToken = prefs.getString("device_token", null)
        if (savedToken != null) apiClient.setAuthToken(savedToken)
        downloadManager = ModelDownloadManager(this)
        downloadManager.authToken = savedToken
        buildUI()
        fetchVisionModels()
    }

    private fun buildUI() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF080A12.toInt())
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        // ── HEADER ──
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setBackgroundColor(0xFF0C0E1A.toInt())
            gravity = Gravity.CENTER_VERTICAL
        }

        backBtn = ImageButton(this).apply {
            setImageResource(R.drawable.ic_back)
            setBackgroundColor(0)
            setOnClickListener { finish() }
        }
        header.addView(backBtn, LinearLayout.LayoutParams(dp(40), dp(40)))

        header.addView(TextView(this).apply {
            text = "Vision — Detection & Segmentation"
            setTextColor(0xFFFFFFFF.toInt()); textSize = 15f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(dp(12), 0, 0, 0)
        }, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(header)

        // Offline banner
        if (!NexusApiClient.isNetworkAvailable(this)) {
            root.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
                setBackgroundColor(0x33F87171.toInt())
                setPadding(dp(12), dp(6), dp(12), dp(6))
                addView(TextView(this@VisionActivity).apply {
                    text = "\u26A0 Offline — server models unavailable"
                    textSize = 11f; setTextColor(0xFFF87171.toInt())
                    setTypeface(null, android.graphics.Typeface.BOLD); gravity = Gravity.CENTER
                })
            })
        }

        // ── SCROLLABLE CONTENT ──
        val scroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(12), dp(16), dp(16))
        }

        // ═══ TASK TOGGLE ═══
        val taskToggle = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.mode_toggle_bg)
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }

        tabDetect = Button(this).apply {
            text = "Detection"; textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(0xFFFFFFFF.toInt())
            background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.tab_active)
            setPadding(dp(16), dp(10), dp(16), dp(10)); isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { setTask("detect") }
        }

        tabSegment = Button(this).apply {
            text = "Segmentation"; textSize = 13f
            setTextColor(0xFF8B8B9E.toInt())
            background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.tab_inactive)
            setPadding(dp(16), dp(10), dp(16), dp(10)); isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { setTask("segment") }
        }

        taskToggle.addView(tabDetect)
        taskToggle.addView(tabSegment)
        content.addView(taskToggle, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })

        // ═══ INFERENCE MODE ═══
        val modeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.mode_toggle_bg)
            setPadding(dp(3), dp(3), dp(3), dp(3))
        }

        modeOnDevice = Button(this).apply {
            text = "On-Device"; textSize = 12f
            setTextColor(0xFF8B8B9E.toInt())
            background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.tab_inactive)
            setPadding(dp(12), dp(8), dp(12), dp(8)); isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { setVisionInferenceMode("on_device") }
        }

        modeServer = Button(this).apply {
            text = "Server"; textSize = 12f
            setTypeface(null, android.graphics.Typeface.BOLD)
            setTextColor(0xFFFFFFFF.toInt())
            background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.tab_active)
            setPadding(dp(12), dp(8), dp(12), dp(8)); isAllCaps = false
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
            setOnClickListener { setVisionInferenceMode("server") }
        }

        modeRow.addView(modeOnDevice)
        modeRow.addView(modeServer)
        content.addView(modeRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })

        // ═══ VISION MODELS ═══
        val modelsCard = CardView(this).apply {
            radius = dp(12).toFloat(); cardElevation = 0f
            setCardBackgroundColor(0xFF0C0E1A.toInt())
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        }

        val modelsInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }

        modelsInner.addView(TextView(this).apply {
            text = "VISION MODELS"; textSize = 10f; setTextColor(0xFF888888.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD)
            setPadding(0, 0, 0, dp(8))
        })

        modelsContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        modelsContainer.addView(TextView(this).apply {
            text = "Loading models..."; textSize = 12f; setTextColor(0xFF6B6B7E.toInt())
            gravity = Gravity.CENTER; setPadding(0, dp(16), 0, dp(16))
        })
        modelsInner.addView(modelsContainer)
        modelsCard.addView(modelsInner)
        content.addView(modelsCard)

        // ═══ IMAGE INPUT ═══
        val btnRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }

        val cameraBtn = Button(this).apply {
            text = "\uD83D\uDCF7 Camera"; setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFF7B9FC7.toInt()); textSize = 12f
            setOnClickListener { handleCamera() }
        }
        btnRow.addView(cameraBtn, LinearLayout.LayoutParams(0, dp(40), 1f).apply { marginEnd = dp(6) })

        val galleryBtn = Button(this).apply {
            text = "\uD83D\uDDBC Gallery"; setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFF34D399.toInt()); textSize = 12f
            setOnClickListener { handleGallery() }
        }
        btnRow.addView(galleryBtn, LinearLayout.LayoutParams(0, dp(40), 1f).apply { marginStart = dp(6) })

        content.addView(btnRow, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })

        // ═══ CONTROLS ═══
        val controlsCard = CardView(this).apply {
            radius = dp(12).toFloat(); cardElevation = 0f
            setCardBackgroundColor(0xFF0C0E1A.toInt())
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { bottomMargin = dp(12) }
        }

        val controlsInner = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
        }

        // Confidence slider
        confLabel = TextView(this).apply {
            text = "Confidence: 0.25"; textSize = 11f; setTextColor(0xFF8B8B9E.toInt())
        }
        controlsInner.addView(confLabel)

        confSlider = SeekBar(this).apply {
            max = 90; progress = 15  // 0.10 to 1.00, step 0.01
            setPadding(0, dp(4), 0, dp(8))
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {
                    confThreshold = (progress + 10) / 100f
                    confLabel.text = "Confidence: ${String.format("%.2f", confThreshold)}"
                }
                override fun onStartTrackingTouch(seekBar: SeekBar) {}
                override fun onStopTrackingTouch(seekBar: SeekBar) {}
            })
        }
        controlsInner.addView(confSlider)

        // IoU slider
        iouLabel = TextView(this).apply {
            text = "IoU: 0.45"; textSize = 11f; setTextColor(0xFF8B8B9E.toInt())
        }
        controlsInner.addView(iouLabel)

        iouSlider = SeekBar(this).apply {
            max = 90; progress = 35
            setPadding(0, dp(4), 0, dp(8))
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(seekBar: SeekBar, progress: Int, fromUser: Boolean) {
                    iouThreshold = (progress + 10) / 100f
                    iouLabel.text = "IoU: ${String.format("%.2f", iouThreshold)}"
                }
                override fun onStartTrackingTouch(seekBar: SeekBar) {}
                override fun onStopTrackingTouch(seekBar: SeekBar) {}
            })
        }
        controlsInner.addView(iouSlider)

        controlsCard.addView(controlsInner)
        content.addView(controlsCard)

        // Run button
        detectBtn = Button(this).apply {
            text = "\u25B6 Detect Objects"; setTextColor(0xFFFFFFFF.toInt())
            setBackgroundColor(0xFFD63384.toInt()); textSize = 13f
            setTypeface(null, android.graphics.Typeface.BOLD)
            isEnabled = false; setOnClickListener { runInference() }
        }
        content.addView(detectBtn, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, dp(44)
        ).apply { bottomMargin = dp(12) })

        // Empty state
        emptyState = TextView(this).apply {
            text = "Select an image to run detection or segmentation"
            setTextColor(0xFF555555.toInt()); textSize = 13f
            gravity = Gravity.CENTER; setPadding(0, dp(40), 0, dp(40))
        }
        content.addView(emptyState)

        // Camera preview
        previewView = PreviewView(this).apply { visibility = View.GONE }
        content.addView(previewView, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(300)))

        // Image preview container
        imageContainer = FrameLayout(this).apply { visibility = View.GONE }
        imageView = ImageView(this).apply {
            scaleType = ImageView.ScaleType.FIT_CENTER; adjustViewBounds = true
        }
        imageContainer.addView(imageView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT))

        overlayView = DetectionOverlayView(this)
        imageContainer.addView(overlayView, FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        content.addView(imageContainer, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })

        // Annotated image from server (decoded from base64)
        annotatedImageView = ImageView(this).apply {
            visibility = View.GONE; scaleType = ImageView.ScaleType.FIT_CENTER; adjustViewBounds = true
        }
        content.addView(annotatedImageView, LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
        ).apply { bottomMargin = dp(12) })

        // Results
        resultText = TextView(this).apply {
            setTextColor(0xFF7B9FC7.toInt()); textSize = 13f; visibility = View.GONE
        }
        content.addView(resultText)

        scroll.addView(content)
        root.addView(scroll)
        setContentView(root)
    }

    // ── Task & Mode Toggles ──

    private fun setTask(task: String) {
        currentTask = task
        if (task == "detect") {
            tabDetect.setTypeface(null, android.graphics.Typeface.BOLD)
            tabDetect.setTextColor(0xFFFFFFFF.toInt())
            tabDetect.background = ContextCompat.getDrawable(this, R.drawable.tab_active)
            tabSegment.setTypeface(null, android.graphics.Typeface.NORMAL)
            tabSegment.setTextColor(0xFF8B8B9E.toInt())
            tabSegment.background = ContextCompat.getDrawable(this, R.drawable.tab_inactive)
            detectBtn.text = "\u25B6 Detect Objects"
        } else {
            tabSegment.setTypeface(null, android.graphics.Typeface.BOLD)
            tabSegment.setTextColor(0xFFFFFFFF.toInt())
            tabSegment.background = ContextCompat.getDrawable(this, R.drawable.tab_active)
            tabDetect.setTypeface(null, android.graphics.Typeface.NORMAL)
            tabDetect.setTextColor(0xFF8B8B9E.toInt())
            tabDetect.background = ContextCompat.getDrawable(this, R.drawable.tab_inactive)
            detectBtn.text = "\u25B6 Segment Objects"
        }
        updateModelsList()
    }

    private fun setVisionInferenceMode(mode: String) {
        inferenceMode = mode
        if (mode == "on_device") {
            modeOnDevice.setTypeface(null, android.graphics.Typeface.BOLD)
            modeOnDevice.setTextColor(0xFFFFFFFF.toInt())
            modeOnDevice.background = ContextCompat.getDrawable(this, R.drawable.tab_active)
            modeServer.setTypeface(null, android.graphics.Typeface.NORMAL)
            modeServer.setTextColor(0xFF8B8B9E.toInt())
            modeServer.background = ContextCompat.getDrawable(this, R.drawable.tab_inactive)
        } else {
            modeServer.setTypeface(null, android.graphics.Typeface.BOLD)
            modeServer.setTextColor(0xFFFFFFFF.toInt())
            modeServer.background = ContextCompat.getDrawable(this, R.drawable.tab_active)
            modeOnDevice.setTypeface(null, android.graphics.Typeface.NORMAL)
            modeOnDevice.setTextColor(0xFF8B8B9E.toInt())
            modeOnDevice.background = ContextCompat.getDrawable(this, R.drawable.tab_inactive)
        }
        updateModelsList()
    }

    // ── Vision Models ──

    private val gson = Gson()

    private fun fetchVisionModels() {
        val serverUrl = prefs.getString("server_url", null)
        if (serverUrl.isNullOrEmpty()) {
            loadCachedVisionModels()
            return
        }

        // If no network, load from cache immediately
        if (!NexusApiClient.isNetworkAvailable(this)) {
            loadCachedVisionModels()
            return
        }

        scope.launch {
            try {
                apiClient.updateServerUrl(serverUrl)
                val models = apiClient.getVisionModels()
                visionModels = models
                // Cache to SharedPreferences
                prefs.edit().putString("cached_vision_models", gson.toJson(models)).apply()
                updateModelsList()
            } catch (e: Exception) {
                // Try loading from cache on server error
                val cached = loadCachedVisionModels()
                if (!cached) {
                    runOnUiThread {
                        modelsContainer.removeAllViews()
                        modelsContainer.addView(TextView(this@VisionActivity).apply {
                            text = "Failed to load models: ${e.message}"
                            textSize = 11f; setTextColor(0xFFF87171.toInt())
                            gravity = Gravity.CENTER; setPadding(0, dp(12), 0, dp(12))
                        })
                    }
                }
            }
        }
    }

    /** Load vision models from SharedPreferences cache. Returns true if models were loaded. */
    private fun loadCachedVisionModels(): Boolean {
        val json = prefs.getString("cached_vision_models", null) ?: return false
        return try {
            val type = object : TypeToken<List<VisionModelInfo>>() {}.type
            val models: List<VisionModelInfo> = gson.fromJson(json, type)
            if (models.isNotEmpty()) {
                visionModels = models
                updateModelsList()
                true
            } else false
        } catch (_: Exception) { false }
    }

    private fun updateModelsList() {
        modelsContainer.removeAllViews()

        val filtered = visionModels.filter { model ->
            model.task == currentTask || model.task == "both"
        }

        if (filtered.isEmpty()) {
            modelsContainer.addView(TextView(this).apply {
                text = "No ${currentTask} models available"
                textSize = 12f; setTextColor(0xFF6B6B7E.toInt())
                gravity = Gravity.CENTER; setPadding(0, dp(16), 0, dp(16))
            })
            updateDetectBtn()
            return
        }

        for ((i, model) in filtered.withIndex()) {
            modelsContainer.addView(createVisionModelRow(model, i))
        }

        // Auto-select first if none selected
        val filteredIdxInAll = visionModels.indexOf(filtered.firstOrNull())
        if (selectedModelIdx < 0 || selectedModelIdx >= visionModels.size ||
            !filtered.contains(visionModels[selectedModelIdx])) {
            selectedModelIdx = filteredIdxInAll
        }
        updateDetectBtn()
    }

    private fun createVisionModelRow(model: VisionModelInfo, filterIdx: Int): View {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.model_row_bg)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(4) }
        }

        // Radio button for selection
        val radio = RadioButton(this).apply {
            isChecked = visionModels.indexOf(model) == selectedModelIdx
            setOnClickListener {
                selectedModelIdx = visionModels.indexOf(model)
                updateModelsList()
            }
        }
        row.addView(radio)

        val info = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(8) }
        }

        info.addView(TextView(this).apply {
            text = model.name; textSize = 12f; setTextColor(0xFFF0F0F5.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD); isSingleLine = true
        })

        val badgeRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(2), 0, 0)
        }

        badgeRow.addView(TextView(this).apply {
            text = model.format; textSize = 9f; setTextColor(0xFF34D399.toInt())
            background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.badge_jni_bg)
            setPadding(dp(5), dp(1), dp(5), dp(1))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dp(4) }
        })

        badgeRow.addView(TextView(this).apply {
            text = model.task.replaceFirstChar { it.uppercase() }; textSize = 9f
            setTextColor(0xFF06B6D4.toInt())
            background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.badge_task_bg)
            setPadding(dp(5), dp(1), dp(5), dp(1))
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dp(4) }
        })

        badgeRow.addView(TextView(this).apply {
            text = "${model.sizeMB}MB"; textSize = 9f; setTextColor(0xFF8B8B9E.toInt())
        })

        info.addView(badgeRow)
        row.addView(info)

        // Download button (TFLite models only)
        val isTFLite = model.format.equals("TFLite", ignoreCase = true)
        val isDownloaded = isTFLite && downloadManager.isVisionModelDownloaded(model.dirName, model.modelFile)

        if (isTFLite) {
            if (isDownloaded) {
                row.addView(TextView(this).apply {
                    text = "\u2713"; textSize = 14f; setTextColor(0xFF34D399.toInt())
                    setPadding(dp(8), 0, dp(4), 0)
                })
            } else {
                val dlBtn = Button(this).apply {
                    text = "Get"; textSize = 11f
                    setTypeface(null, android.graphics.Typeface.BOLD)
                    setTextColor(0xFFFFFFFF.toInt())
                    background = ContextCompat.getDrawable(this@VisionActivity, R.drawable.btn_download_bg)
                    setPadding(dp(12), dp(5), dp(12), dp(5)); isAllCaps = false
                    setOnClickListener { downloadVisionModel(model) }
                }
                row.addView(dlBtn)
            }
        }

        return row
    }

    private fun downloadVisionModel(model: VisionModelInfo) {
        val key = "${model.dirName}/${model.modelFile}"
        if (downloadJobs.containsKey(key)) return

        val serverUrl = prefs.getString("server_url", "") ?: ""
        if (serverUrl.isEmpty()) {
            Toast.makeText(this, "No server URL", Toast.LENGTH_SHORT).show()
            return
        }

        Toast.makeText(this, "Downloading ${model.name}...", Toast.LENGTH_SHORT).show()

        val job = scope.launch {
            val result = downloadManager.downloadVisionModel(serverUrl, model.dirName, model.modelFile) { _, _ -> }
            downloadJobs.remove(key)
            result.fold(
                onSuccess = {
                    Toast.makeText(this@VisionActivity, "Downloaded ${model.name}", Toast.LENGTH_SHORT).show()
                    updateModelsList()
                },
                onFailure = { e ->
                    Toast.makeText(this@VisionActivity, "Failed: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            )
        }
        downloadJobs[key] = job
    }

    // ── Image Input ──

    private fun handleCamera() {
        if (cameraActive) { captureAndStopCamera(); return }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else { cameraPermissionLauncher.launch(Manifest.permission.CAMERA) }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            imageCapture = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageCapture)
                cameraActive = true
                previewView.visibility = View.VISIBLE
                imageContainer.visibility = View.GONE
                annotatedImageView.visibility = View.GONE
                emptyState.visibility = View.GONE
            } catch (e: Exception) {
                Toast.makeText(this, "Camera failed: ${e.message}", Toast.LENGTH_SHORT).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun captureAndStopCamera() {
        val capture = imageCapture ?: return
        val tempFile = File(cacheDir, "cam_${System.currentTimeMillis()}.jpg")
        capture.takePicture(
            ImageCapture.OutputFileOptions.Builder(tempFile).build(),
            ContextCompat.getMainExecutor(this),
            object : ImageCapture.OnImageSavedCallback {
                override fun onImageSaved(output: ImageCapture.OutputFileResults) {
                    val bitmap = BitmapFactory.decodeFile(tempFile.absolutePath)
                    if (bitmap != null) { currentBitmap = bitmap; showImage(bitmap) }
                    tempFile.delete(); stopCamera()
                }
                override fun onError(e: ImageCaptureException) {
                    Toast.makeText(this@VisionActivity, "Capture failed", Toast.LENGTH_SHORT).show()
                }
            }
        )
    }

    private fun stopCamera() {
        try { ProcessCameraProvider.getInstance(this).get().unbindAll() } catch (_: Exception) {}
        cameraActive = false; previewView.visibility = View.GONE; updateDetectBtn()
    }

    private fun handleGallery() {
        if (cameraActive) stopCamera()
        galleryLauncher.launch(Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI))
    }

    private fun loadImageFromUri(uri: Uri) {
        try {
            val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val source = ImageDecoder.createSource(contentResolver, uri)
                ImageDecoder.decodeBitmap(source).copy(Bitmap.Config.ARGB_8888, true)
            } else {
                @Suppress("DEPRECATION") MediaStore.Images.Media.getBitmap(contentResolver, uri)
            }
            currentBitmap = bitmap; showImage(bitmap); updateDetectBtn()
        } catch (e: Exception) { Toast.makeText(this, "Failed to load image", Toast.LENGTH_SHORT).show() }
    }

    private fun showImage(bitmap: Bitmap) {
        imageView.setImageBitmap(bitmap)
        imageContainer.visibility = View.VISIBLE
        annotatedImageView.visibility = View.GONE
        emptyState.visibility = View.GONE
        overlayView.clear()
        resultText.visibility = View.GONE
    }

    private fun updateDetectBtn() {
        detectBtn.isEnabled = currentBitmap != null && selectedModelIdx >= 0 && selectedModelIdx < visionModels.size
    }

    // ── Inference ──

    private fun runInference() {
        val bitmap = currentBitmap ?: return
        if (selectedModelIdx < 0 || selectedModelIdx >= visionModels.size) return
        val model = visionModels[selectedModelIdx]

        detectBtn.isEnabled = false
        detectBtn.text = "\u23F3 Running..."

        if (inferenceMode == "on_device") {
            runOnDeviceInference(bitmap, model)
        } else {
            // Check network before server mode — auto-fallback to on-device if offline
            if (!NexusApiClient.isNetworkAvailable(this)) {
                val isTFLite = model.format.equals("TFLite", ignoreCase = true)
                val localAvailable = isTFLite && downloadManager.isVisionModelDownloaded(model.dirName, model.modelFile)
                if (localAvailable) {
                    Toast.makeText(this, "Offline — using on-device model", Toast.LENGTH_SHORT).show()
                    runOnDeviceInference(bitmap, model)
                } else {
                    Toast.makeText(this, "No network. Download a TFLite model for offline use.", Toast.LENGTH_LONG).show()
                    resetDetectBtn()
                }
            } else {
                runServerInference(bitmap, model)
            }
        }
    }

    private fun runOnDeviceInference(bitmap: Bitmap, model: VisionModelInfo) {
        val modelFile = downloadManager.getVisionModelFile(model.dirName, model.modelFile)
        if (!modelFile.exists()) {
            Toast.makeText(this, "Model not downloaded. Download first.", Toast.LENGTH_SHORT).show()
            resetDetectBtn(); return
        }

        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    if (!tfliteDetector.isReady()) {
                        tfliteDetector.loadModel(modelFile, model.imgSize)
                    }
                }

                if (currentTask == "segment") {
                    val result = withContext(Dispatchers.IO) {
                        tfliteDetector.detectAndSegment(bitmap, confThreshold, iouThreshold)
                    }
                    overlayView.setSegmentations(result.detections, bitmap.width, bitmap.height)
                    annotatedImageView.visibility = View.GONE
                    showResults(result.detections.map { it.label }, result.detectionCount, result.inferenceTimeMs, "On-Device")
                } else {
                    val result = withContext(Dispatchers.IO) {
                        tfliteDetector.detect(bitmap, confThreshold, iouThreshold)
                    }
                    overlayView.setDetections(result.detections, bitmap.width, bitmap.height)
                    annotatedImageView.visibility = View.GONE
                    showResults(result.detections.map { it.label }, result.detectionCount, result.inferenceTimeMs, "On-Device")
                }
            } catch (e: Exception) {
                Toast.makeText(this@VisionActivity, "Inference failed: ${e.message}", Toast.LENGTH_LONG).show()
            } finally { resetDetectBtn() }
        }
    }

    private fun runServerInference(bitmap: Bitmap, model: VisionModelInfo) {
        scope.launch {
            try {
                val tempFile = File(cacheDir, "infer_${System.currentTimeMillis()}.jpg")
                withContext(Dispatchers.IO) {
                    FileOutputStream(tempFile).use { out -> bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out) }
                }

                val result = withContext(Dispatchers.IO) {
                    apiClient.runVisionInference(tempFile, model, currentTask, confThreshold, iouThreshold)
                }
                tempFile.delete()

                // Show annotated image if available
                if (!result.annotatedImage.isNullOrEmpty()) {
                    try {
                        val imageBytes = Base64.decode(result.annotatedImage, Base64.DEFAULT)
                        val annotatedBitmap = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.size)
                        if (annotatedBitmap != null) {
                            annotatedImageView.setImageBitmap(annotatedBitmap)
                            annotatedImageView.visibility = View.VISIBLE
                            overlayView.clear()
                        }
                    } catch (_: Exception) {
                        // Fall back to overlay
                        showServerDetectionsAsOverlay(result, bitmap)
                    }
                } else {
                    showServerDetectionsAsOverlay(result, bitmap)
                }

                val labels = result.detections.mapNotNull { it.`class` ?: it.className }
                showResults(labels, result.detectionCount, result.inferenceTimeMs.toLong(), "Server")

            } catch (e: Exception) {
                // Try on-device fallback if TFLite model is available
                val isTFLite = model.format.equals("TFLite", ignoreCase = true)
                val localAvailable = isTFLite && downloadManager.isVisionModelDownloaded(model.dirName, model.modelFile)
                if (localAvailable) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@VisionActivity, "Server error — falling back to on-device", Toast.LENGTH_SHORT).show()
                    }
                    runOnDeviceInference(bitmap, model)
                    return@launch
                }
                withContext(Dispatchers.Main) {
                    Toast.makeText(this@VisionActivity, "Detection failed: ${e.message}", Toast.LENGTH_LONG).show()
                }
            } finally { resetDetectBtn() }
        }
    }

    private fun showServerDetectionsAsOverlay(result: VisionInferenceResult, bitmap: Bitmap) {
        val detections = result.detections.map { det ->
            DetectionBox(
                box = floatArrayOf(
                    det.box[0].toFloat(), det.box[1].toFloat(),
                    det.box[2].toFloat(), det.box[3].toFloat()
                ),
                label = det.`class` ?: det.className ?: "object",
                confidence = (det.confidence ?: 0.0).toFloat()
            )
        }
        overlayView.setDetections(detections, bitmap.width, bitmap.height)
        annotatedImageView.visibility = View.GONE
    }

    private fun showResults(labels: List<String>, count: Int, timeMs: Long, mode: String) {
        val classCounts = labels.groupBy { it }.mapValues { it.value.size }
            .entries.sortedByDescending { it.value }
            .joinToString(", ") { "${it.value}\u00D7 ${it.key}" }

        resultText.text = buildString {
            appendLine("$count detections \u2022 ${timeMs}ms \u2022 $mode")
            if (classCounts.isNotEmpty()) appendLine(classCounts)
        }
        resultText.visibility = View.VISIBLE
    }

    private fun resetDetectBtn() {
        detectBtn.isEnabled = true
        detectBtn.text = if (currentTask == "detect") "\u25B6 Detect Objects" else "\u25B6 Segment Objects"
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        super.onDestroy(); scope.cancel(); cameraExecutor.shutdown(); tfliteDetector.close()
        downloadJobs.values.forEach { it.cancel() }
    }

    companion object {
        fun launch(context: Context) { context.startActivity(Intent(context, VisionActivity::class.java)) }
    }
}
