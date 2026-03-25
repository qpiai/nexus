package com.nexus.v4

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import org.tensorflow.lite.Interpreter
import org.tensorflow.lite.gpu.GpuDelegate
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

data class DetectionResult(
    val detections: List<DetectionBox>,
    val detectionCount: Int,
    val inferenceTimeMs: Long
)

class TFLiteDetector(private val context: Context) {

    private var interpreter: Interpreter? = null
    private var gpuDelegate: GpuDelegate? = null
    private var imgSize = 640
    private var isLoaded = false

    fun isReady() = isLoaded

    fun loadModel(modelFile: File, imgSize: Int = 640) {
        this.imgSize = imgSize
        close()

        val options = Interpreter.Options().apply {
            setNumThreads(4)
            try {
                val delegate = GpuDelegate()
                addDelegate(delegate)
                gpuDelegate = delegate
            } catch (_: Exception) {}
        }

        interpreter = Interpreter(modelFile, options)
        isLoaded = true
    }

    private fun preprocessImage(bitmap: Bitmap): ByteBuffer {
        val resized = Bitmap.createScaledBitmap(bitmap, imgSize, imgSize, true)
        val inputBuffer = ByteBuffer.allocateDirect(1 * imgSize * imgSize * 3 * 4)
            .order(ByteOrder.nativeOrder())
        val pixels = IntArray(imgSize * imgSize)
        resized.getPixels(pixels, 0, imgSize, 0, 0, imgSize, imgSize)
        for (pixel in pixels) {
            inputBuffer.putFloat(((pixel shr 16) and 0xFF) / 255f)
            inputBuffer.putFloat(((pixel shr 8) and 0xFF) / 255f)
            inputBuffer.putFloat((pixel and 0xFF) / 255f)
        }
        inputBuffer.rewind()
        return inputBuffer
    }

    fun detect(bitmap: Bitmap, confThreshold: Float = 0.25f, iouThreshold: Float = 0.45f): DetectionResult {
        val interp = interpreter ?: return DetectionResult(emptyList(), 0, 0)

        val startTime = System.currentTimeMillis()
        val inputBuffer = preprocessImage(bitmap)

        val outputTensor = interp.getOutputTensor(0)
        val outputShape = outputTensor.shape()
        val dim1 = outputShape[1]
        val dim2 = outputShape[2]
        val transposed = dim1 < dim2
        val numDetections = if (transposed) dim2 else dim1
        val numFields = if (transposed) dim1 else dim2
        val numClasses = numFields - 4

        val outputArray = Array(1) { Array(dim1) { FloatArray(dim2) } }
        interp.run(inputBuffer, outputArray)
        val elapsed = System.currentTimeMillis() - startTime

        val rawBoxes = mutableListOf<DetectionBox>()
        for (i in 0 until numDetections) {
            val cx: Float; val cy: Float; val w: Float; val h: Float
            val classScores = FloatArray(numClasses)

            if (transposed) {
                cx = outputArray[0][0][i]; cy = outputArray[0][1][i]
                w = outputArray[0][2][i]; h = outputArray[0][3][i]
                for (c in 0 until numClasses) classScores[c] = outputArray[0][4 + c][i]
            } else {
                cx = outputArray[0][i][0]; cy = outputArray[0][i][1]
                w = outputArray[0][i][2]; h = outputArray[0][i][3]
                for (c in 0 until numClasses) classScores[c] = outputArray[0][i][4 + c]
            }

            val maxClassIdx = classScores.indices.maxByOrNull { classScores[it] } ?: continue
            val maxConf = classScores[maxClassIdx]
            if (maxConf < confThreshold) continue

            val scaleX = bitmap.width.toFloat() / imgSize
            val scaleY = bitmap.height.toFloat() / imgSize
            val x1 = (cx - w / 2) * scaleX; val y1 = (cy - h / 2) * scaleY
            val x2 = (cx + w / 2) * scaleX; val y2 = (cy + h / 2) * scaleY

            val label = if (maxClassIdx < COCO_LABELS.size) COCO_LABELS[maxClassIdx] else "class_$maxClassIdx"
            rawBoxes.add(DetectionBox(floatArrayOf(x1, y1, x2, y2), label, maxConf))
        }

        val finalBoxes = nms(rawBoxes, iouThreshold)
        return DetectionResult(finalBoxes, finalBoxes.size, elapsed)
    }

    fun detectAndSegment(bitmap: Bitmap, confThreshold: Float = 0.25f, iouThreshold: Float = 0.45f): SegmentationResult {
        val interp = interpreter ?: return SegmentationResult(emptyList(), 0, 0)

        val startTime = System.currentTimeMillis()
        val inputBuffer = preprocessImage(bitmap)

        val numOutputs = interp.outputTensorCount

        // Check if segmentation model (2 outputs)
        if (numOutputs < 2) {
            // Fall back to detection-only
            val detResult = detect(bitmap, confThreshold, iouThreshold)
            val segBoxes = detResult.detections.map {
                SegmentationBox(it.box, it.label, it.confidence, null)
            }
            return SegmentationResult(segBoxes, segBoxes.size, detResult.inferenceTimeMs)
        }

        // Output 0: detection boxes [1, 116, 8400] — 80 classes + 4 bbox + 32 mask coefficients
        val detTensor = interp.getOutputTensor(0)
        val detShape = detTensor.shape()
        val detDim1 = detShape[1]
        val detDim2 = detShape[2]

        // Output 1: prototype masks [1, 32, 160, 160]
        val maskTensor = interp.getOutputTensor(1)
        val maskShape = maskTensor.shape()
        val numProtos = maskShape[1]  // 32
        val protoH = maskShape[2]     // 160
        val protoW = maskShape[3]     // 160

        // Allocate outputs
        val detOutput = Array(1) { Array(detDim1) { FloatArray(detDim2) } }
        val maskOutput = Array(1) { Array(numProtos) { Array(protoH) { FloatArray(protoW) } } }

        val outputs = HashMap<Int, Any>()
        outputs[0] = detOutput
        outputs[1] = maskOutput
        interp.runForMultipleInputsOutputs(arrayOf(inputBuffer), outputs)

        val transposed = detDim1 < detDim2
        val numDetections = if (transposed) detDim2 else detDim1
        val numFields = if (transposed) detDim1 else detDim2
        val numClasses = numFields - 4 - numProtos  // 80

        data class RawDetection(
            val box: FloatArray, val label: String, val confidence: Float,
            val maskCoeffs: FloatArray
        )

        val rawDets = mutableListOf<RawDetection>()

        for (i in 0 until numDetections) {
            val cx: Float; val cy: Float; val w: Float; val h: Float
            val classScores = FloatArray(numClasses)
            val maskCoeffs = FloatArray(numProtos)

            if (transposed) {
                cx = detOutput[0][0][i]; cy = detOutput[0][1][i]
                w = detOutput[0][2][i]; h = detOutput[0][3][i]
                for (c in 0 until numClasses) classScores[c] = detOutput[0][4 + c][i]
                for (m in 0 until numProtos) maskCoeffs[m] = detOutput[0][4 + numClasses + m][i]
            } else {
                cx = detOutput[0][i][0]; cy = detOutput[0][i][1]
                w = detOutput[0][i][2]; h = detOutput[0][i][3]
                for (c in 0 until numClasses) classScores[c] = detOutput[0][i][4 + c]
                for (m in 0 until numProtos) maskCoeffs[m] = detOutput[0][i][4 + numClasses + m]
            }

            val maxClassIdx = classScores.indices.maxByOrNull { classScores[it] } ?: continue
            val maxConf = classScores[maxClassIdx]
            if (maxConf < confThreshold) continue

            val scaleX = bitmap.width.toFloat() / imgSize
            val scaleY = bitmap.height.toFloat() / imgSize
            val x1 = (cx - w / 2) * scaleX; val y1 = (cy - h / 2) * scaleY
            val x2 = (cx + w / 2) * scaleX; val y2 = (cy + h / 2) * scaleY

            val label = if (maxClassIdx < COCO_LABELS.size) COCO_LABELS[maxClassIdx] else "class_$maxClassIdx"
            rawDets.add(RawDetection(floatArrayOf(x1, y1, x2, y2), label, maxConf, maskCoeffs))
        }

        // NMS
        val sorted = rawDets.sortedByDescending { it.confidence }.toMutableList()
        val kept = mutableListOf<RawDetection>()
        while (sorted.isNotEmpty()) {
            val best = sorted.removeAt(0)
            kept.add(best)
            sorted.removeAll { iou(best.box, it.box) > iouThreshold }
        }

        // Generate masks for kept detections
        val results = kept.map { det ->
            // Multiply mask coefficients by prototype masks
            val instanceMask = Array(protoH) { FloatArray(protoW) }
            for (ph in 0 until protoH) {
                for (pw in 0 until protoW) {
                    var sum = 0f
                    for (m in 0 until numProtos) {
                        sum += det.maskCoeffs[m] * maskOutput[0][m][ph][pw]
                    }
                    instanceMask[ph][pw] = 1f / (1f + Math.exp(-sum.toDouble()).toFloat()) // sigmoid
                }
            }

            // Create bitmap mask scaled to image size
            val maskBitmap = Bitmap.createBitmap(bitmap.width, bitmap.height, Bitmap.Config.ARGB_8888)
            val maskScaleX = bitmap.width.toFloat() / protoW
            val maskScaleY = bitmap.height.toFloat() / protoH

            // Clip mask to bounding box
            val bx1 = maxOf(0, det.box[0].toInt())
            val by1 = maxOf(0, det.box[1].toInt())
            val bx2 = minOf(bitmap.width - 1, det.box[2].toInt())
            val by2 = minOf(bitmap.height - 1, det.box[3].toInt())

            for (py in by1..by2) {
                for (px in bx1..bx2) {
                    val protoX = (px / maskScaleX).toInt().coerceIn(0, protoW - 1)
                    val protoY = (py / maskScaleY).toInt().coerceIn(0, protoH - 1)
                    if (instanceMask[protoY][protoX] > 0.5f) {
                        maskBitmap.setPixel(px, py, Color.WHITE)
                    }
                }
            }

            SegmentationBox(det.box, det.label, det.confidence, maskBitmap)
        }

        val elapsed = System.currentTimeMillis() - startTime
        return SegmentationResult(results, results.size, elapsed)
    }

    private fun nms(boxes: List<DetectionBox>, iouThreshold: Float): List<DetectionBox> {
        val sorted = boxes.sortedByDescending { it.confidence }.toMutableList()
        val result = mutableListOf<DetectionBox>()
        while (sorted.isNotEmpty()) {
            val best = sorted.removeAt(0)
            result.add(best)
            sorted.removeAll { iou(best.box, it.box) > iouThreshold }
        }
        return result
    }

    private fun iou(a: FloatArray, b: FloatArray): Float {
        val x1 = maxOf(a[0], b[0]); val y1 = maxOf(a[1], b[1])
        val x2 = minOf(a[2], b[2]); val y2 = minOf(a[3], b[3])
        val inter = maxOf(0f, x2 - x1) * maxOf(0f, y2 - y1)
        val aArea = (a[2] - a[0]) * (a[3] - a[1])
        val bArea = (b[2] - b[0]) * (b[3] - b[1])
        val union = aArea + bArea - inter
        return if (union > 0) inter / union else 0f
    }

    fun close() {
        interpreter?.close()
        gpuDelegate?.close()
        interpreter = null
        gpuDelegate = null
        isLoaded = false
    }

    companion object {
        val COCO_LABELS = arrayOf(
            "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck",
            "boat", "traffic light", "fire hydrant", "stop sign", "parking meter", "bench",
            "bird", "cat", "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra",
            "giraffe", "backpack", "umbrella", "handbag", "tie", "suitcase", "frisbee",
            "skis", "snowboard", "sports ball", "kite", "baseball bat", "baseball glove",
            "skateboard", "surfboard", "tennis racket", "bottle", "wine glass", "cup",
            "fork", "knife", "spoon", "bowl", "banana", "apple", "sandwich", "orange",
            "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair", "couch",
            "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
            "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
            "refrigerator", "book", "clock", "vase", "scissors", "teddy bear",
            "hair drier", "toothbrush"
        )
    }
}
