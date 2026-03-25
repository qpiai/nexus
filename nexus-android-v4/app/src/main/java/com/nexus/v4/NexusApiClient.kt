package com.nexus.v4

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import java.io.File
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

data class RegisterResponse(val id: String, val token: String? = null, val message: String, val wsEndpoint: String)
data class ModelInfo(val name: String, val file: String, val method: String, val sizeMB: Int)
data class ModelsResponse(val models: List<ModelInfo>)

data class DeviceHardware(
    val name: String, val platform: String, val cpuModel: String,
    val cpuCores: Int, val ramGB: Int, val storageGB: Int
)

// Vision model data classes
data class VisionModelInfo(
    val name: String, val dirName: String, val modelFile: String,
    val format: String, val task: String, val sizeMB: Int,
    val downloadUrl: String, val precision: String, val imgSize: Int,
    val mobileCompatible: Boolean
)

data class VisionModelsResponse(val models: List<VisionModelInfo>)

data class VisionDetection(
    val box: List<Double>, val `class`: String?, val confidence: Double?,
    val className: String?, val classId: Int?
)

data class VisionInferenceResult(
    val detections: List<VisionDetection>, val annotatedImage: String?,
    val inferenceTimeMs: Double, val detectionCount: Int
)

class NexusApiClient(private var serverUrl: String) {
    companion object {
        fun isNetworkAvailable(context: Context): Boolean {
            val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
            val network = cm?.activeNetwork ?: return false
            val caps = cm.getNetworkCapabilities(network) ?: return false
            return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        }
    }

    private var authToken: String? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, java.util.concurrent.TimeUnit.SECONDS)
        .readTimeout(60, java.util.concurrent.TimeUnit.SECONDS)
        .addInterceptor { chain ->
            val original = chain.request()
            val token = authToken
            val request = if (token != null) {
                original.newBuilder().header("Authorization", "Bearer $token").build()
            } else { original }
            chain.proceed(request)
        }
        .build()
    private val gson = Gson()
    private var eventSource: EventSource? = null
    private var disconnected = false
    private var sseRetryCount = 0

    fun updateServerUrl(url: String) { serverUrl = url.trimEnd('/') }
    fun getAuthToken(): String? = authToken
    fun setAuthToken(token: String?) { authToken = token }
    fun getServerUrl(): String = serverUrl

    suspend fun registerDevice(deviceInfo: DeviceHardware, deviceId: String? = null): RegisterResponse = withContext(Dispatchers.IO) {
        val payload = mutableMapOf<String, Any>(
            "name" to deviceInfo.name, "platform" to deviceInfo.platform,
            "hardware" to mapOf(
                "cpuModel" to deviceInfo.cpuModel, "cpuCores" to deviceInfo.cpuCores,
                "ramGB" to deviceInfo.ramGB, "storageGB" to deviceInfo.storageGB
            )
        )
        if (deviceId != null) payload["deviceId"] = deviceId
        val json = gson.toJson(payload)
        val request = Request.Builder()
            .url("$serverUrl/api/mobile/register")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()

        suspendCancellableCoroutine { cont ->
            client.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { cont.resumeWithException(e) }
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        val body = it.body?.string() ?: "{}"
                        if (it.isSuccessful) cont.resume(gson.fromJson(body, RegisterResponse::class.java))
                        else cont.resumeWithException(IOException("Register failed: ${it.code} $body"))
                    }
                }
            })
        }
    }

    suspend fun getModels(): List<ModelInfo> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("$serverUrl/api/chat/models").get().build()
        suspendCancellableCoroutine { cont ->
            client.newCall(request).enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) { cont.resumeWithException(e) }
                override fun onResponse(call: Call, response: Response) {
                    response.use {
                        val body = it.body?.string() ?: "{\"models\":[]}"
                        if (it.isSuccessful) {
                            val resp = gson.fromJson(body, ModelsResponse::class.java)
                            cont.resume(resp.models)
                        } else cont.resumeWithException(IOException("Failed: ${it.code}"))
                    }
                }
            })
        }
    }

    suspend fun sendMetrics(deviceId: String, metrics: Map<String, Any>) = withContext(Dispatchers.IO) {
        val json = gson.toJson(mapOf("deviceId" to deviceId, "type" to "metrics_update", "data" to metrics))
        val request = Request.Builder()
            .url("$serverUrl/api/mobile/ws")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }

    fun connectSSE(deviceId: String, listener: SSEListener) {
        sseRetryCount = 0; disconnected = false
        eventSource?.cancel(); eventSource = null
        val request = Request.Builder().url("$serverUrl/api/mobile/ws?deviceId=$deviceId").build()
        val factory = EventSources.createFactory(client)
        eventSource = factory.newEventSource(request, object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) { listener.onConnected() }
            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) { listener.onEvent(type ?: "", data) }
            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                listener.onError(t?.message ?: "Connection failed")
                if (!disconnected && sseRetryCount < 10) {
                    sseRetryCount++
                    val delay = minOf(5000L * sseRetryCount, 30000L)
                    android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({
                        connectSSE(deviceId, listener)
                    }, delay)
                }
            }
            override fun onClosed(eventSource: EventSource) { listener.onDisconnected() }
        })
    }

    fun disconnectSSE() { disconnected = true; eventSource?.cancel(); eventSource = null }

    suspend fun sendInferenceMetrics(deviceId: String, metrics: Map<String, Any>) = withContext(Dispatchers.IO) {
        val json = gson.toJson(mapOf("deviceId" to deviceId, "type" to "inference_metrics", "data" to metrics))
        val request = Request.Builder()
            .url("$serverUrl/api/mobile/ws")
            .post(json.toRequestBody("application/json".toMediaType()))
            .build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }

    // ── Vision API Methods ──

    suspend fun getVisionModels(): List<VisionModelInfo> = withContext(Dispatchers.IO) {
        val request = Request.Builder().url("$serverUrl/api/mobile/vision/models").get().build()
        val response = client.newCall(request).execute()
        if (!response.isSuccessful) throw IOException("Vision models failed: ${response.code}")
        val body = response.body?.string() ?: throw IOException("Empty response")
        val type = object : TypeToken<Map<String, List<VisionModelInfo>>>() {}.type
        val parsed: Map<String, List<VisionModelInfo>> = gson.fromJson(body, type)
        parsed["models"] ?: emptyList()
    }

    suspend fun runVisionInference(
        imageFile: File, model: VisionModelInfo, task: String, conf: Float, iou: Float
    ): VisionInferenceResult = withContext(Dispatchers.IO) {
        val requestBody = MultipartBody.Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("image", "photo.jpg", imageFile.asRequestBody("image/jpeg".toMediaType()))
            .addFormDataPart("modelDirName", model.dirName)
            .addFormDataPart("modelFile", model.modelFile)
            .addFormDataPart("task", task)
            .addFormDataPart("conf", conf.toString())
            .addFormDataPart("iou", iou.toString())
            .build()

        val longClient = client.newBuilder()
            .readTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
            .build()

        val request = Request.Builder()
            .url("$serverUrl/api/mobile/vision/infer")
            .post(requestBody)
            .build()

        val response = longClient.newCall(request).execute()
        if (!response.isSuccessful) throw IOException("Vision inference failed: ${response.code}")
        val body = response.body?.string() ?: throw IOException("Empty response")
        gson.fromJson(body, VisionInferenceResult::class.java)
    }

    interface SSEListener {
        fun onConnected()
        fun onDisconnected()
        fun onEvent(type: String, data: String)
        fun onError(message: String)
    }
}
