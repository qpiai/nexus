#include <android/log.h>
#include <jni.h>
#include <iomanip>
#include <cmath>
#include <string>
#include <unistd.h>
#include <sampling.h>

#include "logging.h"
#include "chat.h"
#include "common.h"
#include "llama.h"

// ── LLama resources ──

constexpr int   N_THREADS_MIN        = 2;
constexpr int   N_THREADS_MAX        = 4;
constexpr int   N_THREADS_HEADROOM   = 2;

constexpr int   DEFAULT_CONTEXT_SIZE = 8192;
constexpr int   OVERFLOW_HEADROOM    = 4;
constexpr int   BATCH_SIZE           = 512;
constexpr float DEFAULT_SAMPLER_TEMP = 0.3f;

static llama_model                   * g_model;
static llama_context                 * g_context;
static llama_batch                     g_batch;
static common_chat_templates_ptr       g_chat_templates;
static common_sampler                * g_sampler;

// ── JNI: init ──

extern "C"
JNIEXPORT void JNICALL
Java_com_nexus_v7_engine_LlamaEngine_nativeInit(JNIEnv *env, jobject, jstring nativeLibDir) {
    llama_log_set(nexus_android_log_callback, nullptr);

    const auto *path = env->GetStringUTFChars(nativeLibDir, 0);
    LOGi("Loading backends from %s", path);
    ggml_backend_load_all_from_path(path);
    env->ReleaseStringUTFChars(nativeLibDir, path);

    llama_backend_init();
    LOGi("Backend initialized.");
}

// ── JNI: load model ──

extern "C"
JNIEXPORT jint JNICALL
Java_com_nexus_v7_engine_LlamaEngine_nativeLoadModel(JNIEnv *env, jobject, jstring jmodelPath) {
    llama_model_params model_params = llama_model_default_params();
    const auto *model_path = env->GetStringUTFChars(jmodelPath, 0);
    LOGd("Loading model from: %s", model_path);

    auto *model = llama_model_load_from_file(model_path, model_params);
    env->ReleaseStringUTFChars(jmodelPath, model_path);
    if (!model) {
        LOGe("Failed to load model");
        return 1;
    }
    g_model = model;
    return 0;
}

// ── Helper: create context ──

static llama_context *init_context(llama_model *model, const int n_ctx = DEFAULT_CONTEXT_SIZE) {
    if (!model) {
        LOGe("%s: model cannot be null", __func__);
        return nullptr;
    }

    const int n_threads = std::max(N_THREADS_MIN, std::min(N_THREADS_MAX,
                                                     (int) sysconf(_SC_NPROCESSORS_ONLN) -
                                                     N_THREADS_HEADROOM));
    LOGi("%s: Using %d threads", __func__, n_threads);

    llama_context_params ctx_params = llama_context_default_params();
    ctx_params.n_ctx     = n_ctx;
    ctx_params.n_batch   = BATCH_SIZE;
    ctx_params.n_ubatch  = BATCH_SIZE;
    ctx_params.n_threads = n_threads;
    ctx_params.n_threads_batch = n_threads;

    auto *context = llama_init_from_model(model, ctx_params);
    if (!context) {
        LOGe("%s: llama_init_from_model() returned null", __func__);
    }
    return context;
}

static common_sampler *new_sampler(float temp) {
    common_params_sampling sparams;
    sparams.temp = temp;
    return common_sampler_init(g_model, sparams);
}

// ── JNI: prepare ──

extern "C"
JNIEXPORT jint JNICALL
Java_com_nexus_v7_engine_LlamaEngine_nativePrepare(JNIEnv *, jobject) {
    auto *context = init_context(g_model);
    if (!context) { return 1; }
    g_context = context;
    g_batch = llama_batch_init(BATCH_SIZE, 0, 1);
    g_chat_templates = common_chat_templates_init(g_model, "");
    g_sampler = new_sampler(DEFAULT_SAMPLER_TEMP);
    return 0;
}

// ── Chat state ──

constexpr const char *ROLE_SYSTEM    = "system";
constexpr const char *ROLE_USER      = "user";
constexpr const char *ROLE_ASSISTANT = "assistant";

static std::vector<common_chat_msg> chat_msgs;
static llama_pos system_prompt_position;
static llama_pos current_position;

static void reset_long_term_states(const bool clear_kv_cache = true) {
    chat_msgs.clear();
    system_prompt_position = 0;
    current_position = 0;
    if (clear_kv_cache && g_context)
        llama_memory_clear(llama_get_memory(g_context), false);
}

static llama_pos stop_generation_position;
static std::string cached_token_chars;
static std::ostringstream assistant_ss;

static void reset_short_term_states() {
    stop_generation_position = 0;
    cached_token_chars.clear();
    assistant_ss.str("");
}

// ── Context shifting ──

static void shift_context() {
    const int n_discard = (current_position - system_prompt_position) / 2;
    LOGi("%s: Discarding %d tokens", __func__, n_discard);
    llama_memory_seq_rm(llama_get_memory(g_context), 0, system_prompt_position, system_prompt_position + n_discard);
    llama_memory_seq_add(llama_get_memory(g_context), 0, system_prompt_position + n_discard, current_position, -n_discard);
    current_position -= n_discard;
    LOGi("%s: Context shift done. Position: %d", __func__, current_position);
}

// ── Chat formatting ──

static std::string chat_add_and_format(const std::string &role, const std::string &content) {
    common_chat_msg new_msg;
    new_msg.role = role;
    new_msg.content = content;
    auto formatted = common_chat_format_single(
            g_chat_templates.get(), chat_msgs, new_msg, role == ROLE_USER, false);
    chat_msgs.push_back(new_msg);
    LOGd("%s: Formatted %s message: %s", __func__, role.c_str(), formatted.c_str());
    return formatted;
}

// ── Batch decode helper ──

static int decode_tokens_in_batches(
        llama_context *context,
        llama_batch &batch,
        const llama_tokens &tokens,
        const llama_pos start_pos,
        const bool compute_last_logit = false) {
    LOGd("%s: Decode %d tokens at position %d", __func__, (int) tokens.size(), start_pos);
    for (int i = 0; i < (int) tokens.size(); i += BATCH_SIZE) {
        const int cur_batch_size = std::min((int) tokens.size() - i, BATCH_SIZE);
        common_batch_clear(batch);

        if (start_pos + i + cur_batch_size >= DEFAULT_CONTEXT_SIZE - OVERFLOW_HEADROOM) {
            LOGw("%s: Context full, shifting...", __func__);
            shift_context();
        }

        for (int j = 0; j < cur_batch_size; j++) {
            const llama_token token_id = tokens[i + j];
            const llama_pos position = start_pos + i + j;
            const bool want_logit = compute_last_logit && (i + j == (int) tokens.size() - 1);
            common_batch_add(batch, token_id, position, {0}, want_logit);
        }

        if (llama_decode(context, batch)) {
            LOGe("%s: llama_decode failed", __func__);
            return 1;
        }
    }
    return 0;
}

// ── JNI: process system prompt ──

extern "C"
JNIEXPORT jint JNICALL
Java_com_nexus_v7_engine_LlamaEngine_nativeSetSystemPrompt(JNIEnv *env, jobject, jstring jprompt) {
    reset_long_term_states();
    reset_short_term_states();

    const auto *system_prompt = env->GetStringUTFChars(jprompt, nullptr);
    std::string formatted(system_prompt);
    env->ReleaseStringUTFChars(jprompt, system_prompt);

    const bool has_tmpl = common_chat_templates_was_explicit(g_chat_templates.get());
    if (has_tmpl) {
        formatted = chat_add_and_format(ROLE_SYSTEM, system_prompt);
    }

    const auto system_tokens = common_tokenize(g_context, formatted, has_tmpl, has_tmpl);

    const int max_batch = DEFAULT_CONTEXT_SIZE - OVERFLOW_HEADROOM;
    if ((int) system_tokens.size() > max_batch) {
        LOGe("System prompt too long: %d tokens, max: %d", (int) system_tokens.size(), max_batch);
        return 1;
    }

    if (decode_tokens_in_batches(g_context, g_batch, system_tokens, current_position)) {
        LOGe("llama_decode() failed for system prompt");
        return 2;
    }

    system_prompt_position = current_position = (int) system_tokens.size();
    return 0;
}

// ── JNI: process user prompt ──

extern "C"
JNIEXPORT jint JNICALL
Java_com_nexus_v7_engine_LlamaEngine_nativeSendUserPrompt(JNIEnv *env, jobject, jstring jprompt, jint nPredict) {
    reset_short_term_states();

    const auto *user_prompt = env->GetStringUTFChars(jprompt, nullptr);
    std::string formatted(user_prompt);
    env->ReleaseStringUTFChars(jprompt, user_prompt);

    const bool has_tmpl = common_chat_templates_was_explicit(g_chat_templates.get());
    if (has_tmpl) {
        formatted = chat_add_and_format(ROLE_USER, user_prompt);
    }

    auto user_tokens = common_tokenize(g_context, formatted, has_tmpl, has_tmpl);

    const int max_batch = DEFAULT_CONTEXT_SIZE - OVERFLOW_HEADROOM;
    if ((int) user_tokens.size() > max_batch) {
        const int skipped = (int) user_tokens.size() - max_batch;
        user_tokens.resize(max_batch);
        LOGw("User prompt too long, skipped %d tokens", skipped);
    }

    if (decode_tokens_in_batches(g_context, g_batch, user_tokens, current_position, true)) {
        LOGe("llama_decode() failed for user prompt");
        return 2;
    }

    const int user_size = (int) user_tokens.size();
    current_position += user_size;
    stop_generation_position = current_position + user_size + nPredict;
    return 0;
}

// ── UTF-8 validation ──

static bool is_valid_utf8(const char *string) {
    if (!string) { return true; }
    const auto *bytes = (const unsigned char *) string;
    int num;
    while (*bytes != 0x00) {
        if ((*bytes & 0x80) == 0x00) {
            num = 1;
        } else if ((*bytes & 0xE0) == 0xC0) {
            num = 2;
        } else if ((*bytes & 0xF0) == 0xE0) {
            num = 3;
        } else if ((*bytes & 0xF8) == 0xF0) {
            num = 4;
        } else {
            return false;
        }
        bytes += 1;
        for (int i = 1; i < num; ++i) {
            if ((*bytes & 0xC0) != 0x80) { return false; }
            bytes += 1;
        }
    }
    return true;
}

// ── JNI: generate next token ──

extern "C"
JNIEXPORT jstring JNICALL
Java_com_nexus_v7_engine_LlamaEngine_nativeGenerateNextToken(JNIEnv *env, jobject) {
    // Context shifting if full
    if (current_position >= DEFAULT_CONTEXT_SIZE - OVERFLOW_HEADROOM) {
        LOGw("Context full, shifting...");
        shift_context();
    }

    // Stop at marked position
    if (current_position >= stop_generation_position) {
        LOGd("Stop: hit position %d", stop_generation_position);
        return nullptr;
    }

    // Sample
    const auto new_token_id = common_sampler_sample(g_sampler, g_context, -1);
    common_sampler_accept(g_sampler, new_token_id, true);

    // Decode
    common_batch_clear(g_batch);
    common_batch_add(g_batch, new_token_id, current_position, {0}, true);
    if (llama_decode(g_context, g_batch) != 0) {
        LOGe("llama_decode() failed for generated token");
        return nullptr;
    }
    current_position++;

    // EOG check
    if (llama_vocab_is_eog(llama_model_get_vocab(g_model), new_token_id)) {
        LOGd("EOG token reached");
        chat_add_and_format(ROLE_ASSISTANT, assistant_ss.str());
        return nullptr;
    }

    // Convert to text
    auto new_token_chars = common_token_to_piece(g_context, new_token_id);
    cached_token_chars += new_token_chars;

    jstring result = nullptr;
    if (is_valid_utf8(cached_token_chars.c_str())) {
        result = env->NewStringUTF(cached_token_chars.c_str());
        assistant_ss << cached_token_chars;
        cached_token_chars.clear();
    } else {
        result = env->NewStringUTF("");
    }
    return result;
}

// ── JNI: unload model ──

extern "C"
JNIEXPORT void JNICALL
Java_com_nexus_v7_engine_LlamaEngine_nativeUnload(JNIEnv *, jobject) {
    reset_long_term_states();
    reset_short_term_states();

    common_sampler_free(g_sampler);
    g_chat_templates.reset();
    llama_batch_free(g_batch);
    llama_free(g_context);
    llama_model_free(g_model);

    g_sampler = nullptr;
    g_context = nullptr;
    g_model = nullptr;
}

// ── JNI: shutdown backend ──

extern "C"
JNIEXPORT void JNICALL
Java_com_nexus_v7_engine_LlamaEngine_nativeShutdown(JNIEnv *, jobject) {
    llama_backend_free();
}
