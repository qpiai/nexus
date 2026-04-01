package com.nexus.v7.vision

import android.content.Context
import android.graphics.*
import android.util.AttributeSet
import android.view.View

data class DetectionBox(
    val box: FloatArray,      // [x1, y1, x2, y2]
    val label: String,
    val confidence: Float
)

data class SegmentationBox(
    val box: FloatArray,      // [x1, y1, x2, y2]
    val label: String,
    val confidence: Float,
    val mask: Bitmap?         // binary mask at image resolution, null for detect-only
)

data class SegmentationResult(
    val detections: List<SegmentationBox>,
    val detectionCount: Int,
    val inferenceTimeMs: Long
)

class DetectionOverlayView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private var detections: List<DetectionBox> = emptyList()
    private var segmentations: List<SegmentationBox> = emptyList()
    private var imgWidth = 1
    private var imgHeight = 1
    private var isSegMode = false

    private val boxPaint = Paint().apply {
        style = Paint.Style.STROKE
        strokeWidth = 3f
        isAntiAlias = true
    }

    private val labelPaint = Paint().apply {
        textSize = 28f
        isFakeBoldText = true
        isAntiAlias = true
    }

    private val labelBgPaint = Paint().apply {
        style = Paint.Style.FILL
        isAntiAlias = true
    }

    private val maskPaint = Paint().apply {
        isAntiAlias = true
        alpha = 80
    }

    private val colors = intArrayOf(
        Color.parseColor("#8b5cf6"), Color.parseColor("#3b82f6"),
        Color.parseColor("#10b981"), Color.parseColor("#f59e0b"),
        Color.parseColor("#ef4444"), Color.parseColor("#ec4899"),
        Color.parseColor("#06b6d4"), Color.parseColor("#84cc16"),
    )

    fun setDetections(dets: List<DetectionBox>, imageW: Int, imageH: Int) {
        detections = dets
        segmentations = emptyList()
        imgWidth = imageW
        imgHeight = imageH
        isSegMode = false
        invalidate()
    }

    fun setSegmentations(segs: List<SegmentationBox>, imageW: Int, imageH: Int) {
        segmentations = segs
        detections = emptyList()
        imgWidth = imageW
        imgHeight = imageH
        isSegMode = true
        invalidate()
    }

    fun clear() {
        detections = emptyList()
        segmentations = emptyList()
        isSegMode = false
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)

        val scaleX = width.toFloat() / imgWidth
        val scaleY = height.toFloat() / imgHeight

        if (isSegMode && segmentations.isNotEmpty()) {
            segmentations.forEachIndexed { idx, seg ->
                val color = colors[idx % colors.size]
                if (seg.mask != null) {
                    val coloredMask = Bitmap.createBitmap(seg.mask.width, seg.mask.height, Bitmap.Config.ARGB_8888)
                    val maskPixels = IntArray(seg.mask.width * seg.mask.height)
                    seg.mask.getPixels(maskPixels, 0, seg.mask.width, 0, 0, seg.mask.width, seg.mask.height)
                    val overlayColor = Color.argb(80, Color.red(color), Color.green(color), Color.blue(color))
                    for (i in maskPixels.indices) {
                        maskPixels[i] = if (maskPixels[i] != 0) overlayColor else Color.TRANSPARENT
                    }
                    coloredMask.setPixels(maskPixels, 0, coloredMask.width, 0, 0, coloredMask.width, coloredMask.height)
                    val destRect = RectF(0f, 0f, width.toFloat(), height.toFloat())
                    canvas.drawBitmap(coloredMask, null, destRect, null)
                    coloredMask.recycle()
                }

                val x1 = seg.box[0] * scaleX
                val y1 = seg.box[1] * scaleY
                val x2 = seg.box[2] * scaleX
                val y2 = seg.box[3] * scaleY
                boxPaint.color = color
                canvas.drawRect(x1, y1, x2, y2, boxPaint)

                val label = "${seg.label} ${(seg.confidence * 100).toInt()}%"
                labelPaint.color = Color.WHITE
                labelBgPaint.color = color
                val textW = labelPaint.measureText(label)
                val textH = 32f
                val lx = x1
                val ly = maxOf(y1 - textH - 4, 0f)
                canvas.drawRect(lx, ly, lx + textW + 12, ly + textH, labelBgPaint)
                canvas.drawText(label, lx + 6, ly + textH - 6, labelPaint)
            }
        } else if (detections.isNotEmpty()) {
            detections.forEachIndexed { idx, det ->
                val color = colors[idx % colors.size]
                val x1 = det.box[0] * scaleX
                val y1 = det.box[1] * scaleY
                val x2 = det.box[2] * scaleX
                val y2 = det.box[3] * scaleY

                boxPaint.color = color
                canvas.drawRect(x1, y1, x2, y2, boxPaint)

                val label = "${det.label} ${(det.confidence * 100).toInt()}%"
                labelPaint.color = Color.WHITE
                labelBgPaint.color = color
                val textW = labelPaint.measureText(label)
                val textH = 32f
                val lx = x1
                val ly = maxOf(y1 - textH - 4, 0f)
                canvas.drawRect(lx, ly, lx + textW + 12, ly + textH, labelBgPaint)
                canvas.drawText(label, lx + 6, ly + textH - 6, labelPaint)
            }
        }
    }
}
