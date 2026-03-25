package com.nexus.v4

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.io.File

class LlamaEngine private constructor(
    private val nativeLibDir: String
) {
    companion object {
        private const val TAG = "LlamaEngine"
        private const val DEFAULT_PREDICT_LENGTH = 512

        @Volatile
        private var instance: LlamaEngine? = null

        fun getInstance(context: Context): LlamaEngine =
            instance ?: synchronized(this) {
                instance ?: run {
                    val libDir = context.applicationInfo.nativeLibraryDir
                    require(libDir.isNotBlank()) { "Invalid native library path" }
                    LlamaEngine(libDir).also { instance = it }
                }
            }
    }

    private external fun nativeInit(nativeLibDir: String)
    private external fun nativeLoadModel(modelPath: String): Int
    private external fun nativePrepare(): Int
    private external fun nativeSetSystemPrompt(prompt: String): Int
    private external fun nativeSendUserPrompt(prompt: String, predictLen: Int): Int
    private external fun nativeGenerateNextToken(): String?
    private external fun nativeUnload()
    private external fun nativeShutdown()

    sealed class State {
        object Uninitialized : State()
        object Initializing : State()
        object Initialized : State()
        object LoadingModel : State()
        object ModelReady : State()
        object Generating : State()
        data class Error(val exception: Throwable) : State()
    }

    private val _state = MutableStateFlow<State>(State.Uninitialized)
    val state: StateFlow<State> = _state.asStateFlow()

    @Volatile
    private var cancelGeneration = false

    @OptIn(ExperimentalCoroutinesApi::class)
    private val llamaDispatcher = Dispatchers.IO.limitedParallelism(1)
    private val llamaScope = CoroutineScope(llamaDispatcher + SupervisorJob())

    interface StateListener {
        fun onStateChanged(state: State)
    }

    private var stateListener: StateListener? = null

    fun setStateListener(listener: StateListener?) {
        stateListener = listener
    }

    init {
        llamaScope.launch {
            try {
                check(_state.value is State.Uninitialized) { "Already initialized" }
                _state.value = State.Initializing
                notifyListener()
                Log.i(TAG, "Loading native library...")
                System.loadLibrary("nexus_llama")
                nativeInit(nativeLibDir)
                _state.value = State.Initialized
                notifyListener()
                Log.i(TAG, "Native library loaded and backend initialized.")
            } catch (e: Exception) {
                Log.e(TAG, "Failed to initialize", e)
                _state.value = State.Error(e)
                notifyListener()
                throw e
            }
        }
    }

    suspend fun loadModel(pathToModel: String) = withContext(llamaDispatcher) {
        check(_state.value is State.Initialized) {
            "Cannot load model in state: ${_state.value}"
        }
        try {
            val file = File(pathToModel)
            require(file.exists() && file.isFile && file.canRead()) {
                "Cannot read model file: $pathToModel"
            }
            Log.i(TAG, "Loading model: $pathToModel")
            _state.value = State.LoadingModel
            notifyListener()
            val loadResult = nativeLoadModel(pathToModel)
            if (loadResult != 0) throw RuntimeException("Model load failed (code $loadResult)")
            val prepResult = nativePrepare()
            if (prepResult != 0) throw RuntimeException("Prepare failed (code $prepResult)")
            Log.i(TAG, "Model loaded and ready.")
            cancelGeneration = false
            _state.value = State.ModelReady
            notifyListener()
        } catch (e: Exception) {
            Log.e(TAG, "Error loading model", e)
            _state.value = State.Error(e)
            notifyListener()
            throw e
        }
    }

    suspend fun setSystemPrompt(prompt: String) = withContext(llamaDispatcher) {
        require(prompt.isNotBlank()) { "System prompt cannot be empty" }
        check(_state.value is State.ModelReady) {
            "Cannot set system prompt in state: ${_state.value}"
        }
        Log.i(TAG, "Processing system prompt...")
        val result = nativeSetSystemPrompt(prompt)
        if (result != 0) {
            val err = RuntimeException("System prompt processing failed (code $result)")
            _state.value = State.Error(err)
            notifyListener()
            throw err
        }
        Log.i(TAG, "System prompt processed.")
    }

    fun chat(
        userMessage: String,
        maxTokens: Int = DEFAULT_PREDICT_LENGTH
    ): Flow<String> = flow {
        require(userMessage.isNotEmpty()) { "User message cannot be empty" }
        check(_state.value is State.ModelReady) {
            "Cannot chat in state: ${_state.value}"
        }
        try {
            cancelGeneration = false
            _state.value = State.Generating
            notifyListener()
            val promptResult = nativeSendUserPrompt(userMessage, maxTokens)
            if (promptResult != 0) {
                Log.e(TAG, "Failed to process user prompt: $promptResult")
                _state.value = State.ModelReady
                notifyListener()
                return@flow
            }
            while (!cancelGeneration) {
                val token = nativeGenerateNextToken()
                if (token == null) break
                if (token.isNotEmpty()) emit(token)
            }
            if (cancelGeneration) Log.i(TAG, "Generation cancelled.")
            else Log.i(TAG, "Generation complete.")
            _state.value = State.ModelReady
            notifyListener()
        } catch (e: CancellationException) {
            Log.i(TAG, "Generation flow cancelled.")
            _state.value = State.ModelReady
            notifyListener()
            throw e
        } catch (e: Exception) {
            Log.e(TAG, "Error during generation", e)
            _state.value = State.Error(e)
            notifyListener()
            throw e
        }
    }.flowOn(llamaDispatcher)

    fun cancelChat() { cancelGeneration = true }

    fun unload() {
        cancelGeneration = true
        runBlocking(llamaDispatcher) {
            when (_state.value) {
                is State.ModelReady -> {
                    Log.i(TAG, "Unloading model...")
                    nativeUnload()
                    _state.value = State.Initialized
                    notifyListener()
                    Log.i(TAG, "Model unloaded.")
                }
                is State.Error -> {
                    _state.value = State.Initialized
                    notifyListener()
                }
                else -> {}
            }
        }
    }

    fun destroy() {
        cancelGeneration = true
        runBlocking(llamaDispatcher) {
            when (_state.value) {
                is State.Uninitialized -> {}
                is State.Initialized -> nativeShutdown()
                else -> {
                    try { nativeUnload() } catch (_: Exception) {}
                    nativeShutdown()
                }
            }
        }
        llamaScope.cancel()
    }

    private fun notifyListener() {
        stateListener?.onStateChanged(_state.value)
    }
}
