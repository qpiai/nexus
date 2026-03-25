package com.nexus.v4

import android.Manifest
import android.app.Activity
import android.app.ActivityManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.LinearGradient
import android.graphics.Shader
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.os.BatteryManager
import android.provider.MediaStore
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.BackgroundColorSpan
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.text.style.TypefaceSpan
import android.util.Base64
import android.view.Gravity
import android.view.View
import android.view.animation.AnimationUtils
import android.view.inputmethod.InputMethodManager
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import com.google.gson.Gson
import com.google.gson.JsonObject
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.BufferedReader
import java.io.ByteArrayOutputStream
import java.io.InputStreamReader
import java.util.concurrent.TimeUnit

class ChatActivity : AppCompatActivity() {
    companion object {
        const val EXTRA_MODEL_PATH = "model_path"
        const val EXTRA_MODEL_NAME = "model_name"
        const val EXTRA_INFERENCE_MODE = "inference_mode"
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_MODEL_FILE = "model_file"
        const val EXTRA_MODEL_METHOD = "model_method"
        const val EXTRA_AUTH_TOKEN = "auth_token"
        const val EXTRA_IS_VLM = "is_vlm"
        const val MODE_ON_DEVICE = "on_device"
        const val MODE_SERVER = "server"
    }

    private val scope = CoroutineScope(Dispatchers.Main + SupervisorJob())
    private val gson = Gson()
    private var chatAuthToken: String? = null

    private val client by lazy {
        OkHttpClient.Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .readTimeout(5, TimeUnit.MINUTES)
            .addInterceptor { chain ->
                val original = chain.request()
                val token = chatAuthToken
                val request = if (token != null) {
                    original.newBuilder().header("Authorization", "Bearer $token").build()
                } else { original }
                chain.proceed(request)
            }
            .build()
    }

    private var inferenceMode = MODE_ON_DEVICE
    private var serverUrl = ""
    private var modelFile = ""
    private var modelMethod = "GGUF"
    private var isVLM = false

    private lateinit var messagesContainer: LinearLayout
    private lateinit var messagesScroll: ScrollView
    private lateinit var inputField: EditText
    private lateinit var sendButton: Button
    private lateinit var stopButton: Button
    private lateinit var statusText: TextView
    private lateinit var metricsText: TextView

    // VLM image attachment
    private var attachButton: Button? = null
    private var imagePreviewBar: LinearLayout? = null
    private var imagePreviewThumb: ImageView? = null
    private var imagePreviewName: TextView? = null
    private var pendingImageBase64: String? = null
    private var pendingImageBitmap: Bitmap? = null
    private var pendingImageName: String = ""

    data class ChatMessage(val role: String, var content: String, var imageBitmap: Bitmap? = null)

    private val messages = mutableListOf<ChatMessage>()
    private var currentCall: Call? = null
    private var isGenerating = false

    private var llamaEngine: LlamaEngine? = null
    private var modelLoaded = false

    // Resource monitoring
    private lateinit var resourcePanel: LinearLayout
    private lateinit var ramMetricText: TextView
    private lateinit var cpuMetricText: TextView
    private lateinit var tpsMetricText: TextView
    private lateinit var warningBanner: LinearLayout
    private lateinit var warningText: TextView
    private var currentTokPerSec: Double = 0.0
    private var monitorJob: Job? = null

    private val THRESHOLDS = mapOf("memory" to Pair(80, 95), "cpu" to Pair(75, 90))

    // Camera/Gallery launchers for VLM
    private val galleryLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        if (result.resultCode == Activity.RESULT_OK) {
            result.data?.data?.let { uri -> handleImageUri(uri, "gallery_image.jpg") }
        }
    }

    private val cameraPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) launchCamera()
    }

    private var cameraImageCapture: ImageCapture? = null

    private val cameraCaptureLauncher = registerForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap ->
        if (bitmap != null) handleImageResult(bitmap, "camera_photo.jpg")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        inferenceMode = intent.getStringExtra(EXTRA_INFERENCE_MODE) ?: MODE_ON_DEVICE
        serverUrl = intent.getStringExtra(EXTRA_SERVER_URL) ?: ""
        modelFile = intent.getStringExtra(EXTRA_MODEL_FILE) ?: ""
        modelMethod = intent.getStringExtra(EXTRA_MODEL_METHOD) ?: "GGUF"
        chatAuthToken = intent.getStringExtra(EXTRA_AUTH_TOKEN)
        isVLM = intent.getBooleanExtra(EXTRA_IS_VLM, false)
        val modelName = intent.getStringExtra(EXTRA_MODEL_NAME) ?: "Model"

        if (inferenceMode == MODE_SERVER) {
            if (serverUrl.isEmpty()) { finish(); return }
            buildUI(modelName)
            statusText.text = "Connected to server"
            statusText.setTextColor(0xFF34D399.toInt())
            sendButton.isEnabled = true
            statusText.postDelayed({ statusText.visibility = View.GONE }, 2000)
            addSystemMessage("Ready to chat with $modelName via server." +
                if (isVLM) "\nVLM mode: attach images with the clip button." else "")
        } else {
            val modelPath = intent.getStringExtra(EXTRA_MODEL_PATH) ?: run { finish(); return }
            buildUI(modelName)
            loadModelViaJNI(modelPath)
        }
    }

    private fun buildUI(modelName: String) {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(0xFF080A12.toInt())
        }

        // ── HEADER BAR ──
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFF0A0D18.toInt())
            setPadding(dp(14), dp(14), dp(16), dp(14))
        }

        header.addView(ImageButton(this).apply {
            setImageResource(R.drawable.ic_back)
            setBackgroundColor(0x00000000)
            setPadding(dp(4), dp(4), dp(10), dp(4))
            setOnClickListener { finish() }
        })

        val modelTitle = TextView(this).apply {
            text = modelName; textSize = 16f; setTextColor(0xFFF0F0F5.toInt())
            setTypeface(null, Typeface.BOLD); isSingleLine = true
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        modelTitle.post {
            val w = modelTitle.paint.measureText(modelTitle.text.toString())
            if (w > 0) {
                modelTitle.paint.shader = LinearGradient(0f, 0f, w, 0f,
                    intArrayOf(0xFFF0F0F5.toInt(), 0xFF7B9FC7.toInt()), floatArrayOf(0f, 1f), Shader.TileMode.CLAMP)
                modelTitle.invalidate()
            }
        }
        header.addView(modelTitle)

        // VLM badge
        if (isVLM) {
            header.addView(TextView(this).apply {
                text = "VLM"; textSize = 10f; setTextColor(0xFFFFFFFF.toInt())
                background = ContextCompat.getDrawable(this@ChatActivity, R.drawable.badge_vlm_bg)
                setPadding(dp(8), dp(3), dp(8), dp(3))
                setTypeface(null, Typeface.BOLD)
                layoutParams = LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
                ).apply { marginEnd = dp(6) }
            })
        }

        // Mode badge
        val modeBadge = if (inferenceMode == MODE_ON_DEVICE) "On-Device" else "Cloud"
        val badgeColor = if (inferenceMode == MODE_ON_DEVICE) 0xFF34D399.toInt() else 0xFF7B9FC7.toInt()
        header.addView(TextView(this).apply {
            text = modeBadge; textSize = 10f; setTextColor(badgeColor)
            background = ContextCompat.getDrawable(this@ChatActivity, R.drawable.badge_jni_bg)
            setPadding(dp(8), dp(3), dp(8), dp(3))
            setTypeface(null, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { marginEnd = dp(8) }
        })

        metricsText = TextView(this).apply {
            text = ""; textSize = 10f; setTextColor(0xFF7B9FC7.toInt())
            setTypeface(null, Typeface.BOLD)
        }
        header.addView(metricsText)
        root.addView(header)

        root.addView(View(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(2))
            setBackgroundColor(0xFF7B9FC7.toInt()); alpha = 0.3f
        })

        if (inferenceMode == MODE_ON_DEVICE) {
            root.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
                setBackgroundColor(0x1A34D399.toInt())
                setPadding(dp(12), dp(6), dp(12), dp(6))
                addView(TextView(this@ChatActivity).apply {
                    text = "\u26A1 On-Device  \u2022  JNI Engine"
                    textSize = 11f; setTextColor(0xFF34D399.toInt())
                    setTypeface(null, Typeface.BOLD); gravity = Gravity.CENTER
                })
            })
        }

        warningBanner = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(6), dp(12), dp(6)); visibility = View.GONE
        }
        warningText = TextView(this).apply {
            textSize = 12f; setTextColor(0xFFF0F0F5.toInt())
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        }
        warningBanner.addView(warningText)
        root.addView(warningBanner)

        // Offline banner
        if (!NexusApiClient.isNetworkAvailable(this)) {
            root.addView(LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
                setBackgroundColor(0x33F87171.toInt())
                setPadding(dp(12), dp(6), dp(12), dp(6))
                addView(TextView(this@ChatActivity).apply {
                    text = "\u26A0 Offline — using on-device inference"
                    textSize = 11f; setTextColor(0xFFF87171.toInt())
                    setTypeface(null, Typeface.BOLD); gravity = Gravity.CENTER
                })
            })
        }

        resourcePanel = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            setBackgroundColor(0xFF0A0D18.toInt()); setPadding(dp(8), dp(6), dp(8), dp(6))
            visibility = View.GONE
        }
        ramMetricText = createMetricBox("RAM", "-- %")
        cpuMetricText = createMetricBox("CPU", "-- %")
        tpsMetricText = createMetricBox("Speed", "-- t/s")
        resourcePanel.addView(ramMetricText)
        resourcePanel.addView(cpuMetricText)
        resourcePanel.addView(tpsMetricText)
        root.addView(resourcePanel)

        statusText = TextView(this).apply {
            text = "Loading model..."; textSize = 12f; setTextColor(0xFFFBBF24.toInt())
            gravity = Gravity.CENTER; setPadding(dp(16), dp(10), dp(16), dp(10))
            setBackgroundColor(0xFF0A0D18.toInt())
        }
        root.addView(statusText)

        messagesScroll = ScrollView(this).apply {
            layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f)
            setPadding(dp(12), dp(10), dp(12), dp(10))
            isVerticalScrollBarEnabled = false
        }
        messagesContainer = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        messagesScroll.addView(messagesContainer)
        root.addView(messagesScroll)

        // ── IMAGE PREVIEW BAR (VLM only) ──
        imagePreviewBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFF121522.toInt())
            setPadding(dp(12), dp(6), dp(12), dp(6))
            visibility = View.GONE
        }

        imagePreviewThumb = ImageView(this).apply {
            val sz = dp(48)
            layoutParams = LinearLayout.LayoutParams(sz, sz).apply { marginEnd = dp(8) }
            scaleType = ImageView.ScaleType.CENTER_CROP
        }
        imagePreviewBar!!.addView(imagePreviewThumb)

        imagePreviewName = TextView(this).apply {
            text = ""; textSize = 12f; setTextColor(0xFF8B8B9E.toInt())
            isSingleLine = true
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        imagePreviewBar!!.addView(imagePreviewName)

        val removeImageBtn = Button(this).apply {
            text = "\u2715"; textSize = 16f; setTextColor(0xFFF87171.toInt())
            setBackgroundColor(0x00000000)
            setPadding(dp(8), dp(4), dp(8), dp(4))
            setOnClickListener { removeAttachedImage() }
        }
        imagePreviewBar!!.addView(removeImageBtn)
        root.addView(imagePreviewBar)

        // ── INPUT BAR ──
        val inputBar = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL
            setBackgroundColor(0xFF0A0D18.toInt())
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }

        // Attach button (VLM only)
        if (isVLM) {
            attachButton = Button(this).apply {
                text = "\uD83D\uDCCE"; textSize = 18f
                setBackgroundColor(0x00000000)
                setPadding(dp(4), dp(4), dp(8), dp(4))
                setOnClickListener { attachImage() }
            }
            inputBar.addView(attachButton)
        }

        inputField = EditText(this).apply {
            hint = if (isVLM) "Ask about an image..." else "Ask anything..."
            textSize = 14f; setTextColor(0xFFF0F0F5.toInt()); setHintTextColor(0xFF4B4B5E.toInt())
            background = ContextCompat.getDrawable(this@ChatActivity, R.drawable.input_bg_dark)
            setPadding(dp(16), dp(12), dp(16), dp(12)); maxLines = 3
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }

        sendButton = Button(this).apply {
            text = ""; textSize = 13f; setTextColor(0xFFFFFFFF.toInt())
            background = ContextCompat.getDrawable(this@ChatActivity, R.drawable.send_button_bg)
            setCompoundDrawablesWithIntrinsicBounds(R.drawable.ic_send, 0, 0, 0)
            val size = dp(46)
            layoutParams = LinearLayout.LayoutParams(size, size).apply { marginStart = dp(8) }
            isEnabled = false; setOnClickListener { sendMessage() }
        }

        stopButton = Button(this).apply {
            text = ""; textSize = 13f; setTextColor(0xFFFFFFFF.toInt())
            background = ContextCompat.getDrawable(this@ChatActivity, R.drawable.stop_button_bg)
            setCompoundDrawablesWithIntrinsicBounds(R.drawable.ic_stop, 0, 0, 0)
            val size = dp(46)
            layoutParams = LinearLayout.LayoutParams(size, size).apply { marginStart = dp(8) }
            visibility = View.GONE; setOnClickListener { stopGeneration() }
        }

        inputBar.addView(inputField)
        inputBar.addView(sendButton)
        inputBar.addView(stopButton)
        root.addView(inputBar)

        setContentView(root)
    }

    // ── VLM Image Attachment ──

    private fun attachImage() {
        val items = arrayOf("Camera", "Gallery")
        AlertDialog.Builder(this, R.style.Theme_NexusV4)
            .setTitle("Attach Image")
            .setItems(items) { _, which ->
                when (which) {
                    0 -> {
                        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                            launchCamera()
                        } else {
                            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                        }
                    }
                    1 -> {
                        val intent = Intent(Intent.ACTION_PICK, MediaStore.Images.Media.EXTERNAL_CONTENT_URI)
                        galleryLauncher.launch(intent)
                    }
                }
            }
            .show()
    }

    private fun launchCamera() {
        cameraCaptureLauncher.launch(null)
    }

    private fun handleImageUri(uri: Uri, name: String) {
        try {
            val bitmap = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                val source = ImageDecoder.createSource(contentResolver, uri)
                ImageDecoder.decodeBitmap(source).copy(Bitmap.Config.ARGB_8888, true)
            } else {
                @Suppress("DEPRECATION")
                MediaStore.Images.Media.getBitmap(contentResolver, uri)
            }
            handleImageResult(bitmap, name)
        } catch (e: Exception) {
            Toast.makeText(this, "Failed to load image", Toast.LENGTH_SHORT).show()
        }
    }

    private fun handleImageResult(bitmap: Bitmap, name: String) {
        // Resize to max 1024px for base64 efficiency
        val maxDim = 1024
        val scale = minOf(maxDim.toFloat() / bitmap.width, maxDim.toFloat() / bitmap.height, 1f)
        val scaled = if (scale < 1f) {
            Bitmap.createScaledBitmap(bitmap, (bitmap.width * scale).toInt(), (bitmap.height * scale).toInt(), true)
        } else bitmap

        // Compress to JPEG and encode base64
        val baos = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, 85, baos)
        pendingImageBase64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
        pendingImageBitmap = scaled
        pendingImageName = name

        // Show preview
        imagePreviewBar?.visibility = View.VISIBLE
        imagePreviewThumb?.setImageBitmap(scaled)
        imagePreviewName?.text = "$name (${baos.size() / 1024}KB)"
    }

    private fun removeAttachedImage() {
        pendingImageBase64 = null
        pendingImageBitmap = null
        pendingImageName = ""
        imagePreviewBar?.visibility = View.GONE
    }

    // ── JNI Model Loading ──

    private fun loadModelViaJNI(modelPath: String) {
        statusText.text = "Initializing JNI engine..."
        statusText.setTextColor(0xFFFBBF24.toInt())
        statusText.visibility = View.VISIBLE

        scope.launch {
            try {
                val engine = LlamaEngine.getInstance(this@ChatActivity)
                llamaEngine = engine
                engine.state.collect { state ->
                    when (state) {
                        is LlamaEngine.State.Initialized -> {
                            runOnUiThread { statusText.text = "Loading model... (this may take a moment)" }
                            engine.loadModel(modelPath)
                            return@collect
                        }
                        is LlamaEngine.State.ModelReady -> {
                            engine.setSystemPrompt("You are a helpful AI assistant.")
                            modelLoaded = true
                            runOnUiThread {
                                statusText.text = "Model loaded \u2022 Ready"
                                statusText.setTextColor(0xFF34D399.toInt())
                                sendButton.isEnabled = true
                                statusText.postDelayed({ statusText.visibility = View.GONE }, 2000)
                            }
                            return@collect
                        }
                        is LlamaEngine.State.Error -> {
                            val err = state.exception
                            runOnUiThread {
                                statusText.text = "Error: ${err.message}"
                                statusText.setTextColor(0xFFF87171.toInt())
                            }
                            return@collect
                        }
                        else -> {}
                    }
                }
            } catch (e: Exception) {
                runOnUiThread {
                    statusText.text = "Error: ${e.message}"
                    statusText.setTextColor(0xFFF87171.toInt())
                    statusText.visibility = View.VISIBLE
                }
            }
        }
    }

    // ── Message Handling ──

    private fun sendMessage() {
        val text = inputField.text.toString().trim()
        if (text.isEmpty() || isGenerating) return

        performHapticFeedback()
        val imm = getSystemService(INPUT_METHOD_SERVICE) as InputMethodManager
        imm.hideSoftInputFromWindow(inputField.windowToken, 0)
        inputField.setText("")

        // Capture attached image before clearing
        val msgBitmap = pendingImageBitmap

        messages.add(ChatMessage("user", text, msgBitmap))
        addMessageBubble("user", text, msgBitmap)

        messages.add(ChatMessage("assistant", ""))
        val assistantBubble = addMessageBubble("assistant", "\u2022 \u2022 \u2022")

        setGeneratingState(true)
        scope.launch { streamCompletion(text, assistantBubble) }
    }

    private fun addSystemMessage(text: String) {
        val container = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER
            setPadding(dp(24), dp(12), dp(24), dp(12))
        }
        val tv = TextView(this).apply {
            this.text = text; textSize = 12f; setTextColor(0xFF6B6B7E.toInt())
            gravity = Gravity.CENTER
            background = ContextCompat.getDrawable(this@ChatActivity, R.drawable.stat_chip_bg)
            setPadding(dp(14), dp(8), dp(14), dp(8))
        }
        container.addView(tv)
        messagesContainer.addView(container)
    }

    private fun addMessageBubble(role: String, text: String, imageBitmap: Bitmap? = null): TextView {
        val isUser = role == "user"
        val wrapper = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = if (isUser) Gravity.END else Gravity.START
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply { topMargin = dp(8) }
        }

        wrapper.addView(TextView(this).apply {
            this.text = if (isUser) "You" else "Assistant"
            textSize = 10f
            setTextColor(if (isUser) 0xFF7B9FC7.toInt() else 0xFF34D399.toInt())
            setTypeface(null, Typeface.BOLD)
            gravity = if (isUser) Gravity.END else Gravity.START
            setPadding(dp(4), 0, dp(4), dp(2))
        })

        // Show attached image in user bubble
        if (isUser && imageBitmap != null) {
            val imgView = ImageView(this).apply {
                setImageBitmap(imageBitmap)
                adjustViewBounds = true
                scaleType = ImageView.ScaleType.FIT_CENTER
                layoutParams = LinearLayout.LayoutParams(dp(180), LinearLayout.LayoutParams.WRAP_CONTENT).apply {
                    bottomMargin = dp(4)
                    if (isUser) gravity = Gravity.END
                }
            }
            wrapper.addView(imgView)
        }

        val displayText: CharSequence = if (!isUser && text != "\u2022 \u2022 \u2022") {
            renderMarkdown(text)
        } else { text }

        val bubble = TextView(this).apply {
            this.text = displayText; textSize = 14f; setTextColor(0xFFF0F0F5.toInt())
            background = ContextCompat.getDrawable(this@ChatActivity,
                if (isUser) R.drawable.bubble_user else R.drawable.bubble_assistant)
            setPadding(dp(16), dp(12), dp(16), dp(12))
            setLineSpacing(dp(3).toFloat(), 1f)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                marginStart = if (isUser) dp(52) else 0
                marginEnd = if (isUser) 0 else dp(52)
            }
            if (!isUser) {
                setOnLongClickListener {
                    val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("message", this.text))
                    Toast.makeText(this@ChatActivity, R.string.copied_to_clipboard, Toast.LENGTH_SHORT).show()
                    performHapticFeedback()
                    true
                }
            }
        }

        wrapper.addView(bubble)
        wrapper.addView(TextView(this).apply {
            this.text = String.format("%tR", java.util.Date())
            textSize = 9f; setTextColor(0xFF4B4B5E.toInt())
            gravity = if (isUser) Gravity.END else Gravity.START
            setPadding(dp(4), dp(3), dp(4), 0)
        })

        messagesContainer.addView(wrapper)
        try {
            val anim = AnimationUtils.loadAnimation(this, R.anim.slide_in_bottom)
            wrapper.startAnimation(anim)
        } catch (_: Exception) {}
        scrollToBottom()
        return bubble
    }

    private fun performHapticFeedback() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                vibrator.vibrate(VibrationEffect.createOneShot(30, VibrationEffect.DEFAULT_AMPLITUDE))
            }
        } catch (_: Exception) {}
    }

    // ── Markdown Rendering ──

    private fun renderMarkdown(text: String): CharSequence {
        val sb = SpannableStringBuilder()
        val lines = text.split("\n")
        var inCodeBlock = false
        val codeBlockBuffer = StringBuilder()
        for ((idx, line) in lines.withIndex()) {
            if (line.trimStart().startsWith("```")) {
                if (inCodeBlock) {
                    val codeText = codeBlockBuffer.toString().trimEnd('\n')
                    val start = sb.length; sb.append(codeText); val end = sb.length
                    sb.setSpan(TypefaceSpan("monospace"), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    sb.setSpan(ForegroundColorSpan(0xFF34D399.toInt()), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    sb.setSpan(BackgroundColorSpan(0xFF121522.toInt()), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                    sb.append("\n"); codeBlockBuffer.clear(); inCodeBlock = false
                } else { inCodeBlock = true }
                continue
            }
            if (inCodeBlock) { codeBlockBuffer.append(line).append("\n"); continue }
            val trimmed = line.trimStart()
            if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
                sb.append("  \u2022 "); appendInlineMarkdown(sb, trimmed.substring(2))
            } else { appendInlineMarkdown(sb, line) }
            if (idx < lines.size - 1) sb.append("\n")
        }
        if (inCodeBlock && codeBlockBuffer.isNotEmpty()) {
            val codeText = codeBlockBuffer.toString().trimEnd('\n')
            val start = sb.length; sb.append(codeText); val end = sb.length
            sb.setSpan(TypefaceSpan("monospace"), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            sb.setSpan(ForegroundColorSpan(0xFF34D399.toInt()), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            sb.setSpan(BackgroundColorSpan(0xFF121522.toInt()), start, end, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
        return sb
    }

    private fun appendInlineMarkdown(sb: SpannableStringBuilder, text: String) {
        var i = 0
        while (i < text.length) {
            when {
                text[i] == '`' -> {
                    val end = text.indexOf('`', i + 1)
                    if (end > i) {
                        val code = text.substring(i + 1, end)
                        val start = sb.length; sb.append(code); val spanEnd = sb.length
                        sb.setSpan(TypefaceSpan("monospace"), start, spanEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        sb.setSpan(ForegroundColorSpan(0xFF7B9FC7.toInt()), start, spanEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        sb.setSpan(BackgroundColorSpan(0xFF1A1D2E.toInt()), start, spanEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        i = end + 1
                    } else { sb.append(text[i]); i++ }
                }
                i + 1 < text.length && text[i] == '*' && text[i + 1] == '*' -> {
                    val end = text.indexOf("**", i + 2)
                    if (end > i) {
                        val bold = text.substring(i + 2, end)
                        val start = sb.length; sb.append(bold); val spanEnd = sb.length
                        sb.setSpan(StyleSpan(Typeface.BOLD), start, spanEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        i = end + 2
                    } else { sb.append(text[i]); i++ }
                }
                text[i] == '*' -> {
                    val end = text.indexOf('*', i + 1)
                    if (end > i) {
                        val italic = text.substring(i + 1, end)
                        val start = sb.length; sb.append(italic); val spanEnd = sb.length
                        sb.setSpan(StyleSpan(Typeface.ITALIC), start, spanEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                        i = end + 1
                    } else { sb.append(text[i]); i++ }
                }
                else -> { sb.append(text[i]); i++ }
            }
        }
    }

    // ── Chat History ──

    private fun buildJNIPromptWithHistory(currentUserMessage: String): String {
        val history = messages.dropLast(1).filter { it.content.isNotEmpty() }.takeLast(6).dropLast(1)
        val sb = StringBuilder()
        for (msg in history) {
            val role = if (msg.role == "user") "User" else "Assistant"
            sb.append("$role: ${msg.content}\n")
        }
        sb.append("\nUser: $currentUserMessage\nAssistant:")
        return sb.toString()
    }

    // ── Completion Streaming ──

    private suspend fun streamCompletion(userText: String, bubbleView: TextView) {
        if (inferenceMode == MODE_SERVER) {
            // Check network before attempting server inference
            if (!NexusApiClient.isNetworkAvailable(this@ChatActivity)) {
                val modelPath = intent.getStringExtra(EXTRA_MODEL_PATH)
                if (modelPath != null && java.io.File(modelPath).exists()) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@ChatActivity, "Offline — using on-device model", Toast.LENGTH_SHORT).show()
                    }
                    if (!modelLoaded) {
                        withContext(Dispatchers.Main) { bubbleView.text = "Loading local model..." }
                        loadModelViaJNI(modelPath)
                    }
                    streamFromJNI(userText, bubbleView)
                    return
                }
                withContext(Dispatchers.Main) {
                    bubbleView.text = "No network connection. Download a model for offline use."
                    messages.lastOrNull()?.content = bubbleView.text.toString()
                    setGeneratingState(false)
                }
                return
            }
            streamFromServer(userText, bubbleView)
        } else {
            streamFromJNI(userText, bubbleView)
        }
    }

    private suspend fun streamFromJNI(userText: String, bubbleView: TextView) {
        val startTime = System.currentTimeMillis()
        var tokenCount = 0
        val responseBuilder = StringBuilder()
        val engine = llamaEngine
        if (engine == null || !modelLoaded) {
            withContext(Dispatchers.Main) {
                bubbleView.text = "Error: Model not loaded"
                messages.lastOrNull()?.content = "Error: Model not loaded"
                setGeneratingState(false)
            }
            return
        }
        val prompt = buildJNIPromptWithHistory(userText)
        var strippedPrefix = false
        try {
            engine.chat(prompt, 512).collect { token ->
                responseBuilder.append(token)
                if (!strippedPrefix) {
                    val currentText = responseBuilder.toString().trimStart()
                    if (currentText.startsWith("Assistant:")) {
                        responseBuilder.clear()
                        responseBuilder.append(currentText.removePrefix("Assistant:").trimStart())
                        strippedPrefix = true
                    } else if (currentText.length > 12) { strippedPrefix = true }
                }
                tokenCount++
                withContext(Dispatchers.Main) {
                    bubbleView.text = renderMarkdown(responseBuilder.toString())
                    scrollToBottom()
                    if (tokenCount % 10 == 0) {
                        val elapsed = (System.currentTimeMillis() - startTime) / 1000.0
                        if (elapsed > 0) { currentTokPerSec = tokenCount / elapsed; metricsText.text = String.format("%.1f t/s", currentTokPerSec) }
                    }
                }
            }
        } catch (e: CancellationException) {
        } catch (e: Exception) {
            android.util.Log.e("ChatActivity", "JNI inference error", e)
            withContext(Dispatchers.Main) {
                if (responseBuilder.isEmpty()) {
                    val msg = when {
                        e.javaClass.name.contains("UnsatisfiedLinkError") -> "Native library not loaded. Please restart the app."
                        e.message?.contains("not loaded") == true || e.message?.contains("state") == true ->
                            "Model not ready. Go back and re-select the model."
                        else -> "Error: ${e.message}"
                    }
                    bubbleView.text = msg
                    messages.lastOrNull()?.content = msg
                }
            }
        } finally { finalizeCompletion(tokenCount, startTime, responseBuilder, bubbleView) }
    }

    private suspend fun streamFromServer(userText: String, bubbleView: TextView) {
        val startTime = System.currentTimeMillis()
        var tokenCount = 0
        val responseBuilder = StringBuilder()

        try {
            val messagesJson = messages.dropLast(1).takeLast(6).map { msg ->
                val m = mutableMapOf<String, Any>("role" to msg.role, "content" to msg.content)
                m
            }

            val requestMap = mutableMapOf<String, Any>(
                "model" to modelFile,
                "method" to modelMethod,
                "messages" to messagesJson,
                "maxTokens" to 512
            )

            // Include image for VLM
            val imageB64 = pendingImageBase64
            if (isVLM && imageB64 != null) {
                requestMap["image"] = imageB64
            }
            // Clear the pending image after including in request
            removeAttachedImage()

            val requestBody = gson.toJson(requestMap)
            val url = "${serverUrl.trimEnd('/')}/api/chat"
            val request = Request.Builder()
                .url(url)
                .post(requestBody.toRequestBody("application/json".toMediaType()))
                .build()

            currentCall = client.newCall(request)
            val response = withContext(Dispatchers.IO) { currentCall!!.execute() }

            if (!response.isSuccessful) {
                val errorBody = response.body?.string() ?: "Unknown error"
                withContext(Dispatchers.Main) {
                    bubbleView.text = "Error: ${response.code} $errorBody"
                    messages.lastOrNull()?.content = bubbleView.text.toString()
                }
                return
            }

            val body = response.body ?: throw java.io.IOException("Empty response body")
            withContext(Dispatchers.IO) {
                BufferedReader(InputStreamReader(body.byteStream())).use { reader ->
                    var line: String?
                    while (reader.readLine().also { line = it } != null) {
                        val l = line ?: continue
                        if (!l.startsWith("data: ")) continue
                        val data = l.removePrefix("data: ").trim()
                        if (data == "[DONE]") break
                        try {
                            val json = gson.fromJson(data, JsonObject::class.java)
                            val text = json.get("text")?.asString ?: json.get("content")?.asString
                            val message = json.get("message")?.asString
                            val type = json.get("type")?.asString
                            if (text != null && type != "error") {
                                responseBuilder.append(text); tokenCount++
                                withContext(Dispatchers.Main) {
                                    bubbleView.text = renderMarkdown(responseBuilder.toString())
                                    scrollToBottom()
                                    if (tokenCount % 10 == 0) {
                                        val elapsed = (System.currentTimeMillis() - startTime) / 1000.0
                                        if (elapsed > 0) { currentTokPerSec = tokenCount / elapsed; metricsText.text = String.format("%.1f t/s", currentTokPerSec) }
                                    }
                                }
                            } else if (type == "error" || json.has("error")) {
                                val errorMsg = message ?: json.get("error")?.asString ?: "Server error"
                                withContext(Dispatchers.Main) { if (responseBuilder.isEmpty()) bubbleView.text = "Error: $errorMsg" }
                            }
                        } catch (_: Exception) {}
                    }
                }
            }
            response.close()
        } catch (e: Exception) {
            if (e.message?.contains("Canceled") != true) {
                // Try on-device fallback if server failed and no response yet
                val modelPath = intent.getStringExtra(EXTRA_MODEL_PATH)
                if (modelPath != null && java.io.File(modelPath).exists() && responseBuilder.isEmpty()) {
                    withContext(Dispatchers.Main) {
                        Toast.makeText(this@ChatActivity, "Server error — falling back to on-device", Toast.LENGTH_SHORT).show()
                        bubbleView.text = "Switching to local inference..."
                    }
                    if (!modelLoaded) loadModelViaJNI(modelPath)
                    streamFromJNI(userText, bubbleView)
                    return
                }
                withContext(Dispatchers.Main) { if (responseBuilder.isEmpty()) bubbleView.text = "Error: ${e.message}" }
            }
        } finally { finalizeCompletion(tokenCount, startTime, responseBuilder, bubbleView) }
    }

    private suspend fun finalizeCompletion(
        tokenCount: Int, startTime: Long, responseBuilder: StringBuilder,
        @Suppress("UNUSED_PARAMETER") bubbleView: TextView
    ) {
        currentCall = null
        val elapsed = (System.currentTimeMillis() - startTime) / 1000.0
        val tokensPerSec = if (elapsed > 0) tokenCount / elapsed else 0.0
        currentTokPerSec = tokensPerSec
        withContext(Dispatchers.Main) {
            messages.lastOrNull()?.content = responseBuilder.toString()
            if (tokenCount > 0) metricsText.text = String.format("%d tok \u2022 %.1f t/s \u2022 %.1fs", tokenCount, tokensPerSec, elapsed)
            setGeneratingState(false)
            val memUsage = withContext(Dispatchers.IO) { getMemoryUsage() }
            updateResourcePanel(memUsage, -1)
            val modelName = intent.getStringExtra(EXTRA_MODEL_NAME) ?: "Model"
            val chatPrefs = getSharedPreferences("nexus_chat_metrics_v4", Context.MODE_PRIVATE)
            chatPrefs.edit()
                .putFloat("lastTokPerSec", tokensPerSec.toFloat())
                .putString("activeModelName", modelName)
                .putInt("lastTokenCount", tokenCount)
                .putFloat("lastElapsed", elapsed.toFloat())
                .putInt("lastMemoryUsage", memUsage)
                .putInt("totalInferences", chatPrefs.getInt("totalInferences", 0) + 1)
                .putInt("totalTokens", chatPrefs.getInt("totalTokens", 0) + tokenCount)
                .apply()
            reportInferenceMetrics(tokenCount, tokensPerSec, elapsed, memUsage, modelName)
        }
    }

    private fun reportInferenceMetrics(tokenCount: Int, tokensPerSec: Double, elapsed: Double, memUsage: Int, modelName: String) {
        val serverUrl = intent.getStringExtra(EXTRA_SERVER_URL) ?: ""
        val prefs = getSharedPreferences("nexus_v4", Context.MODE_PRIVATE)
        val deviceId = prefs.getString("device_id", null) ?: return
        val url = (if (serverUrl.isNotEmpty()) serverUrl else prefs.getString("server_url", "") ?: "").trimEnd('/')
        if (url.isEmpty()) return
        val apiClient = NexusApiClient(url)
        scope.launch {
            try {
                val batteryLevel = getBatteryLevel()
                val cpuUsage = withContext(Dispatchers.IO) { getCpuUsage() }
                apiClient.sendInferenceMetrics(deviceId, mapOf(
                    "tokensPerSec" to tokensPerSec, "tokenCount" to tokenCount, "elapsed" to elapsed,
                    "memoryUsage" to memUsage, "cpuUsage" to cpuUsage, "batteryLevel" to batteryLevel,
                    "activeModel" to modelName, "inferenceMode" to inferenceMode, "engineType" to "JNI",
                    "timestamp" to System.currentTimeMillis()
                ))
            } catch (_: Exception) {}
        }
    }

    private fun getBatteryLevel(): Int {
        val bm = getSystemService(Context.BATTERY_SERVICE) as? BatteryManager
        return bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) ?: -1
    }

    // ── Resource Monitoring ──

    private fun createMetricBox(label: String, defaultValue: String): TextView {
        return TextView(this).apply {
            text = "$label\n$defaultValue"; textSize = 10f; setTextColor(0xFF8B8B9E.toInt())
            gravity = Gravity.CENTER; setPadding(dp(12), dp(4), dp(12), dp(4))
            setTypeface(Typeface.MONOSPACE, Typeface.BOLD)
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
    }

    private fun getMemoryUsage(): Int {
        val actManager = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val memInfo = ActivityManager.MemoryInfo()
        actManager.getMemoryInfo(memInfo)
        return ((1.0 - memInfo.availMem.toDouble() / memInfo.totalMem) * 100).toInt()
    }

    private fun getCpuUsage(): Int {
        try {
            val line: String
            java.io.RandomAccessFile("/proc/stat", "r").use { reader -> line = reader.readLine() }
            val parts = line.split("\\s+".toRegex())
            val idle = parts[4].toLong()
            val total = parts.drop(1).take(7).sumOf { it.toLong() }
            Thread.sleep(100)
            val line2: String
            java.io.RandomAccessFile("/proc/stat", "r").use { reader -> line2 = reader.readLine() }
            val parts2 = line2.split("\\s+".toRegex())
            val idle2 = parts2[4].toLong()
            val total2 = parts2.drop(1).take(7).sumOf { it.toLong() }
            val idleDiff = idle2 - idle; val totalDiff = total2 - total
            return if (totalDiff > 0) ((totalDiff - idleDiff) * 100 / totalDiff).toInt() else 0
        } catch (e: Exception) { return -1 }
    }

    private fun updateResourcePanel(memUsage: Int, cpuUsage: Int) {
        val memColor = getThresholdColor("memory", memUsage)
        val cpuColor = getThresholdColor("cpu", cpuUsage)
        ramMetricText.text = "RAM\n$memUsage%"; ramMetricText.setTextColor(memColor)
        cpuMetricText.text = "CPU\n${if (cpuUsage >= 0) "$cpuUsage%" else "N/A"}"
        cpuMetricText.setTextColor(if (cpuUsage >= 0) cpuColor else 0xFF8B8B9E.toInt())
        tpsMetricText.text = "Speed\n${if (currentTokPerSec > 0) String.format("%.1f t/s", currentTokPerSec) else "--"}"
        tpsMetricText.setTextColor(0xFF7B9FC7.toInt())
    }

    private fun getThresholdColor(metric: String, value: Int): Int {
        val thresholds = THRESHOLDS[metric] ?: return 0xFF8B8B9E.toInt()
        return when {
            value >= thresholds.second -> 0xFFF87171.toInt()
            value >= thresholds.first -> 0xFFFBBF24.toInt()
            else -> 0xFF8B8B9E.toInt()
        }
    }

    private fun startResourceMonitor() {
        resourcePanel.visibility = View.VISIBLE
        monitorJob?.cancel()
        monitorJob = scope.launch {
            while (isActive && isGenerating) {
                val memUsage = withContext(Dispatchers.IO) { getMemoryUsage() }
                val cpuUsage = withContext(Dispatchers.IO) { getCpuUsage() }
                withContext(Dispatchers.Main) { updateResourcePanel(memUsage, cpuUsage) }
                delay(2000)
            }
        }
    }

    private fun stopResourceMonitor() {
        monitorJob?.cancel(); monitorJob = null; warningBanner.visibility = View.GONE
    }

    private fun stopGeneration() {
        currentCall?.cancel(); currentCall = null; llamaEngine?.cancelChat(); setGeneratingState(false)
    }

    private fun setGeneratingState(generating: Boolean) {
        isGenerating = generating
        sendButton.visibility = if (generating) View.GONE else View.VISIBLE
        stopButton.visibility = if (generating) View.VISIBLE else View.GONE
        inputField.isEnabled = !generating
        attachButton?.isEnabled = !generating
        if (generating) startResourceMonitor() else stopResourceMonitor()
    }

    private fun scrollToBottom() { messagesScroll.post { messagesScroll.fullScroll(ScrollView.FOCUS_DOWN) } }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroy() {
        super.onDestroy(); monitorJob?.cancel(); currentCall?.cancel(); scope.cancel()
    }
}
