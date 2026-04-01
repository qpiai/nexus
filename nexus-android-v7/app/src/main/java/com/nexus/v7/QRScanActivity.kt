package com.nexus.v7

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.util.Log
import android.util.Size
import android.view.Gravity
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import com.google.gson.Gson
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.common.InputImage
import java.util.concurrent.Executors

class QRScanActivity : AppCompatActivity() {

    companion object {
        const val EXTRA_SERVER_URL = "server_url"
        const val EXTRA_PAIRING_TOKEN = "pairing_token"
        private const val TAG = "QRScanActivity"
        private const val CAMERA_PERMISSION_CODE = 100
    }

    private var scanned = false
    private val cameraExecutor = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        buildUI()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else {
            ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_CODE)
        }
    }

    private fun buildUI() {
        val root = FrameLayout(this).apply { setBackgroundColor(0xFF080A12.toInt()) }
        val preview = PreviewView(this).apply {
            id = android.R.id.content + 1
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
            implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
        root.addView(preview)
        val overlay = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(48), dp(24), dp(24))
            layoutParams = FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT)
        }
        overlay.addView(TextView(this).apply {
            text = "Scan Nexus QR Code"; textSize = 20f; setTextColor(0xFFF0F0F5.toInt())
            setTypeface(null, android.graphics.Typeface.BOLD); gravity = Gravity.CENTER
            setShadowLayer(8f, 0f, 2f, 0xFF000000.toInt())
        })
        overlay.addView(TextView(this).apply {
            text = "Point your camera at the QR code on the Nexus dashboard"; textSize = 13f
            setTextColor(0xFFCCCCCC.toInt()); gravity = Gravity.CENTER; setPadding(0, dp(8), 0, 0)
            setShadowLayer(8f, 0f, 2f, 0xFF000000.toInt())
        })
        overlay.addView(android.view.View(this).apply { layoutParams = LinearLayout.LayoutParams(0, 0, 1f) })
        overlay.addView(Button(this).apply {
            text = "Cancel"; textSize = 14f; setTextColor(0xFFFFFFFF.toInt()); setBackgroundColor(0x66000000)
            setPadding(dp(24), dp(12), dp(24), dp(12)); isAllCaps = false
            setOnClickListener { setResult(Activity.RESULT_CANCELED); finish() }
        })
        root.addView(overlay)
        setContentView(root)
    }

    @androidx.camera.core.ExperimentalGetImage
    private fun startCamera() {
        val previewView = findViewById<PreviewView>(android.R.id.content + 1) ?: return
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().also { it.setSurfaceProvider(previewView.surfaceProvider) }
            val imageAnalysis = ImageAnalysis.Builder()
                .setTargetResolution(Size(1280, 720))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()
            val scanner = BarcodeScanning.getClient()
            imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                val mediaImage = imageProxy.image
                if (mediaImage != null && !scanned) {
                    val image = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                    scanner.process(image)
                        .addOnSuccessListener { barcodes ->
                            for (barcode in barcodes) {
                                if (barcode.format == Barcode.FORMAT_QR_CODE) {
                                    val raw = barcode.rawValue ?: continue
                                    val result = extractQrData(raw)
                                    if (result != null && !scanned) {
                                        scanned = true
                                        Log.d(TAG, "Scanned URL: ${result.first}")
                                        val resultIntent = Intent().apply {
                                            putExtra(EXTRA_SERVER_URL, result.first)
                                            result.second?.let { putExtra(EXTRA_PAIRING_TOKEN, it) }
                                        }
                                        setResult(Activity.RESULT_OK, resultIntent)
                                        finish()
                                    }
                                }
                            }
                        }
                        .addOnCompleteListener { imageProxy.close() }
                } else { imageProxy.close() }
            }
            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, preview, imageAnalysis)
            } catch (e: Exception) { Log.e(TAG, "Camera bind failed", e) }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun extractQrData(raw: String): Pair<String, String?>? {
        try {
            val json = Gson().fromJson(raw, Map::class.java)
            val url = json["url"] as? String
            if (url != null && url.startsWith("http")) {
                val token = json["token"] as? String
                return Pair(url.trimEnd('/'), token)
            }
        } catch (_: Exception) {}
        val trimmed = raw.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
            return Pair(trimmed.trimEnd('/'), null)
        }
        return null
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == CAMERA_PERMISSION_CODE && grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
            startCamera()
        } else { setResult(Activity.RESULT_CANCELED); finish() }
    }

    override fun onDestroy() { super.onDestroy(); cameraExecutor.shutdown() }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
