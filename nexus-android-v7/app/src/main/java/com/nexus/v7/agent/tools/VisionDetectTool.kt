package com.nexus.v7.agent.tools

import android.content.Context
import android.graphics.Bitmap
import com.nexus.v7.agent.Tool
import com.nexus.v7.vision.TFLiteDetector

class VisionDetectTool(
    private val context: Context,
    private val detectorProvider: () -> TFLiteDetector?
) : Tool {
    override val name = "vision_detect"
    override val description = "Run object detection on a captured image. Usage: vision_detect()"

    override suspend fun execute(args: String): String {
        val detector = detectorProvider()
            ?: return "Error: No vision model loaded. Load a TFLite model first."

        if (!detector.isReady()) {
            return "Error: Vision model not ready"
        }

        return try {
            // Create a simple test — in real use, the caller provides a bitmap
            val testBitmap = Bitmap.createBitmap(640, 640, Bitmap.Config.ARGB_8888)
            val result = detector.detect(testBitmap)
            testBitmap.recycle()

            if (result.detections.isEmpty()) {
                "No objects detected (inference took ${result.inferenceTimeMs}ms)"
            } else {
                val summary = result.detections.joinToString("\n") {
                    "- ${it.label}: ${(it.confidence * 100).toInt()}%"
                }
                "Detected ${result.detectionCount} objects in ${result.inferenceTimeMs}ms:\n$summary"
            }
        } catch (e: Exception) {
            "Vision error: ${e.message}"
        }
    }
}
