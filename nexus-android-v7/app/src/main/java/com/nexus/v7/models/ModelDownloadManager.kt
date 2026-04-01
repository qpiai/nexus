package com.nexus.v7.models

import android.content.Context
import android.content.SharedPreferences
import com.google.gson.Gson
import com.google.gson.annotations.SerializedName
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.TimeUnit

data class MobileModel(
    val id: String,
    val name: String,
    val file: String,
    @SerializedName("size_bytes") val sizeBytes: Long,
    @SerializedName("size_mb") val sizeMB: Int,
    val quantization: String,
    val method: String,
    @SerializedName("download_url") val downloadUrl: String,
    @SerializedName("recommended_ram_gb") val recommendedRamGB: Int,
    @SerializedName("mobile_compatible") val mobileCompatible: Boolean,
    @SerializedName("is_vlm") val isVLM: Boolean = false
)

data class MobileModelsResponse(val models: List<MobileModel>)

class ModelDownloadManager(private val context: Context) {
    var authToken: String? = null

    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.MINUTES)
        .addInterceptor { chain ->
            val original = chain.request()
            val token = authToken
            val request = if (token != null) {
                original.newBuilder().header("Authorization", "Bearer $token").build()
            } else { original }
            chain.proceed(request)
        }
        .build()
    private val prefs: SharedPreferences =
        context.getSharedPreferences("nexus_models_v7", Context.MODE_PRIVATE)
    private val gson = Gson()

    private val modelsDir: File
        get() = File(context.filesDir, "models").also { it.mkdirs() }

    fun getModelFile(filename: String): File = File(modelsDir, filename)

    fun isModelDownloaded(filename: String): Boolean {
        return getModelFile(filename).exists() && prefs.getBoolean("downloaded_$filename", false)
    }

    fun getDownloadedModels(): Set<String> {
        return prefs.all.keys
            .filter { it.startsWith("downloaded_") && prefs.getBoolean(it, false) }
            .map { it.removePrefix("downloaded_") }
            .toSet()
    }

    fun getDownloadedModelFiles(): List<Pair<String, File>> {
        return getDownloadedModels().map { filename ->
            filename to getModelFile(filename)
        }.filter { it.second.exists() }
    }

    fun getAvailableSpaceMB(): Long {
        val stat = android.os.StatFs(context.filesDir.path)
        return stat.availableBytes / (1024 * 1024)
    }

    suspend fun fetchServerModels(serverUrl: String): Result<List<MobileModel>> = withContext(Dispatchers.IO) {
        val baseUrl = serverUrl.trimEnd('/')

        try {
            val url = "$baseUrl/api/mobile/models"
            val request = Request.Builder().url(url).get().build()
            val response = client.newCall(request).execute()
            if (response.isSuccessful) {
                val body = response.body?.string()
                if (body != null) {
                    val modelsResponse = gson.fromJson(body, MobileModelsResponse::class.java)
                    if (modelsResponse.models.isNotEmpty()) {
                        return@withContext Result.success(modelsResponse.models)
                    }
                }
            }
            response.close()
        } catch (_: Exception) { }

        try {
            val url = "$baseUrl/api/chat/models"
            val request = Request.Builder().url(url).get().build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Failed to fetch models: ${response.code}"))
            }
            val body = response.body?.string() ?: return@withContext Result.failure(Exception("Empty response"))
            val parsed = gson.fromJson(body, com.google.gson.JsonObject::class.java)
            val modelsArray = parsed.getAsJsonArray("models") ?: return@withContext Result.success(emptyList())
            val models = modelsArray.mapNotNull { elem ->
                try {
                    val obj = elem.asJsonObject
                    val file = obj.get("file")?.asString ?: return@mapNotNull null
                    val name = obj.get("name")?.asString ?: file
                    val method = obj.get("method")?.asString ?: "GGUF"
                    val sizeMB = obj.get("sizeMB")?.asInt ?: 0
                    val isVLM = obj.get("isVLM")?.asBoolean ?: false
                    if (method != "GGUF") return@mapNotNull null
                    MobileModel(
                        id = file.lowercase().replace(Regex("[^a-z0-9]+"), "-"),
                        name = name, file = file,
                        sizeBytes = sizeMB.toLong() * 1024 * 1024,
                        sizeMB = sizeMB,
                        quantization = extractQuant(file),
                        method = method,
                        downloadUrl = "/api/quantization/download?file=$file",
                        recommendedRamGB = ((sizeMB * 1.2) / 1024).toInt().coerceAtLeast(1),
                        mobileCompatible = sizeMB < 4096,
                        isVLM = isVLM
                    )
                } catch (_: Exception) { null }
            }
            Result.success(models)
        } catch (e: Exception) { Result.failure(e) }
    }

    private fun extractQuant(filename: String): String {
        val lower = filename.lowercase()
        val patterns = listOf("q2_k","q3_k_s","q3_k_m","q3_k_l","q4_0","q4_1","q4_k_s","q4_k_m","q5_0","q5_1","q5_k_s","q5_k_m","q6_k","q8_0","f16","f32")
        return patterns.firstOrNull { lower.contains(it) }?.uppercase() ?: "GGUF"
    }

    suspend fun downloadModel(
        serverUrl: String, filename: String,
        onProgress: (bytesDownloaded: Long, totalBytes: Long) -> Unit
    ): Result<File> = withContext(Dispatchers.IO) {
        try {
            val url = "${serverUrl.trimEnd('/')}/api/quantization/download?file=$filename"
            val request = Request.Builder().url(url).get().build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Download failed: ${response.code} ${response.message}"))
            }
            val body = response.body ?: return@withContext Result.failure(Exception("Empty response body"))
            val totalBytes = body.contentLength()
            val modelFile = getModelFile(filename)
            val tempFile = File(modelsDir, "$filename.tmp")
            val neededMB = (totalBytes / (1024 * 1024)) + 100
            if (getAvailableSpaceMB() < neededMB) {
                return@withContext Result.failure(Exception("Insufficient disk space. Need ${neededMB}MB, have ${getAvailableSpaceMB()}MB"))
            }
            FileOutputStream(tempFile).use { output ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(16384)
                    var bytesRead: Long = 0
                    var read: Int
                    while (input.read(buffer).also { read = it } != -1) {
                        output.write(buffer, 0, read)
                        bytesRead += read
                        onProgress(bytesRead, totalBytes)
                    }
                }
            }
            if (totalBytes > 0 && tempFile.length() != totalBytes) {
                tempFile.delete()
                return@withContext Result.failure(Exception("Download incomplete: got ${tempFile.length()} bytes, expected $totalBytes"))
            }
            if (modelFile.exists()) modelFile.delete()
            tempFile.renameTo(modelFile)
            prefs.edit().putBoolean("downloaded_$filename", true).apply()
            Result.success(modelFile)
        } catch (e: Exception) {
            File(modelsDir, "$filename.tmp").delete()
            Result.failure(e)
        }
    }

    fun deleteModel(filename: String) {
        getModelFile(filename).delete()
        File(modelsDir, "$filename.tmp").delete()
        prefs.edit().remove("downloaded_$filename").apply()
    }

    // ── Vision Model Management ──

    private val visionModelsDir: File
        get() = File(context.filesDir, "vision_models").also { it.mkdirs() }

    fun getVisionModelFile(dirName: String, fileName: String): File {
        return File(File(visionModelsDir, dirName).also { it.mkdirs() }, fileName)
    }

    fun isVisionModelDownloaded(dirName: String, fileName: String): Boolean {
        return getVisionModelFile(dirName, fileName).exists() &&
                prefs.getBoolean("vision_downloaded_${dirName}_$fileName", false)
    }

    fun getDownloadedVisionModels(): Set<String> {
        return prefs.all.keys
            .filter { it.startsWith("vision_downloaded_") && prefs.getBoolean(it, false) }
            .map { it.removePrefix("vision_downloaded_").substringBefore("_") }
            .toSet()
    }

    suspend fun downloadVisionModel(
        serverUrl: String, dirName: String, fileName: String,
        onProgress: (bytesDownloaded: Long, totalBytes: Long) -> Unit
    ): Result<File> = withContext(Dispatchers.IO) {
        try {
            val url = "${serverUrl.trimEnd('/')}/api/mobile/vision/download?dir=$dirName&file=$fileName"
            val request = Request.Builder().url(url).get().build()
            val response = client.newCall(request).execute()
            if (!response.isSuccessful) {
                return@withContext Result.failure(Exception("Vision download failed: ${response.code}"))
            }
            val body = response.body ?: return@withContext Result.failure(Exception("Empty response"))
            val totalBytes = body.contentLength()
            val modelFile = getVisionModelFile(dirName, fileName)
            val tempFile = File(modelFile.parentFile!!, "$fileName.tmp")
            FileOutputStream(tempFile).use { output ->
                body.byteStream().use { input ->
                    val buffer = ByteArray(16384)
                    var bytesRead: Long = 0
                    var read: Int
                    while (input.read(buffer).also { read = it } != -1) {
                        output.write(buffer, 0, read)
                        bytesRead += read
                        onProgress(bytesRead, totalBytes)
                    }
                }
            }
            if (modelFile.exists()) modelFile.delete()
            tempFile.renameTo(modelFile)
            prefs.edit().putBoolean("vision_downloaded_${dirName}_$fileName", true).apply()
            Result.success(modelFile)
        } catch (e: Exception) { Result.failure(e) }
    }

    fun deleteVisionModel(dirName: String) {
        val dir = File(visionModelsDir, dirName)
        dir.deleteRecursively()
        prefs.edit().apply {
            prefs.all.keys.filter { it.startsWith("vision_downloaded_${dirName}_") }.forEach { remove(it) }
            apply()
        }
    }
}
