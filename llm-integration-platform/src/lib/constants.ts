import { QuantizationPreset, MonitoringThresholds } from './types';

export const MODEL_CATALOG = [
  { name: 'LLaMA 3 8B', params: 8, size: 16, family: 'llama' },
  { name: 'LLaMA 3 70B', params: 70, size: 140, family: 'llama' },
  { name: 'Mistral 7B', params: 7, size: 14, family: 'mistral' },
  { name: 'Phi-3 Mini 3.8B', params: 3.8, size: 7.6, family: 'phi' },
  { name: 'Phi-4 Mini 3.8B', params: 3.8, size: 7.6, family: 'phi' },
  { name: 'Gemma 2B', params: 2, size: 4, family: 'gemma' },
  { name: 'Qwen2 72B', params: 72, size: 144, family: 'qwen' },
  { name: 'LFM 1.2B', params: 1.2, size: 2.4, family: 'lfm' },
  { name: 'DeepSeek-R1 1.5B', params: 1.5, size: 3, family: 'deepseek' },
] as const;

/** RAM safety margin — only use this fraction of device RAM for the model */
export const RAM_SAFETY_FACTOR = 0.7;

/**
 * Estimate model RAM usage in GB for a given quantization bit depth.
 * Formula: (params_in_billions * bits_per_weight) / 8 + overhead
 * Overhead accounts for KV cache, runtime buffers, etc.
 */
export function estimateModelRAM(paramB: number, bits: number): number {
  const modelSizeGB = (paramB * bits) / 8;
  const overhead = Math.max(0.3, modelSizeGB * 0.15); // 15% overhead, min 0.3GB
  return modelSizeGB + overhead;
}

// ---- Supported Models for Quantization (single source of truth) ----
export type ModelType = 'LLM' | 'VLM' | 'Vision-OD' | 'Vision-Seg';

export interface SupportedModel {
  name: string;
  repoId: string;
  methods: ('GGUF' | 'AWQ' | 'GPTQ' | 'BitNet' | 'MLX' | 'FP16')[];
  paramB?: number; // model size in billions of parameters (for safety margin calc)
  isVLM?: boolean; // vision-language model (kept for backwards compat)
  modelType: ModelType;
  family: string;
  description: string;
}

export const SUPPORTED_MODELS: SupportedModel[] = [
  // --- Open access (no HF auth needed) ---
  // SmolLM3
  { name: 'SmolLM3 3B', repoId: 'HuggingFaceTB/SmolLM3-3B', methods: ['GGUF', 'GPTQ', 'FP16'], paramB: 3, modelType: 'LLM', family: 'smollm', description: 'Latest SmolLM — strong reasoning for its size' },
  // SmolLM2 — 135M/360M have hidden dims incompatible with AWQ group_size=128
  { name: 'SmolLM2 135M', repoId: 'HuggingFaceTB/SmolLM2-135M-Instruct', methods: ['GGUF', 'BitNet', 'FP16'], paramB: 0.135, modelType: 'LLM', family: 'smollm', description: 'Ultra-tiny instruction model for IoT/edge' },
  { name: 'SmolLM2 360M', repoId: 'HuggingFaceTB/SmolLM2-360M-Instruct', methods: ['GGUF', 'BitNet', 'FP16'], paramB: 0.36, modelType: 'LLM', family: 'smollm', description: 'Tiny instruction model with good quality' },
  { name: 'SmolLM2 1.7B', repoId: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', methods: ['GGUF', 'AWQ', 'GPTQ', 'BitNet', 'MLX', 'FP16'], paramB: 1.7, modelType: 'LLM', family: 'smollm', description: 'Best quality SmolLM for mobile deployment' },
  // Qwen 3.5 (latest)
  { name: 'Qwen 3.5 4B', repoId: 'Qwen/Qwen3.5-4B', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 4, modelType: 'LLM', family: 'qwen', description: 'Latest Qwen with improved reasoning' },
  { name: 'Qwen 3.5 9B', repoId: 'Qwen/Qwen3.5-9B', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 9, modelType: 'LLM', family: 'qwen', description: 'Premium Qwen for complex tasks' },
  // Qwen 3 — AutoAWQ doesn't support Qwen3 attention architecture
  { name: 'Qwen 3 0.6B', repoId: 'Qwen/Qwen3-0.6B', methods: ['GGUF', 'GPTQ', 'BitNet', 'MLX', 'FP16'], paramB: 0.6, modelType: 'LLM', family: 'qwen', description: 'Next-gen tiny reasoning model' },
  { name: 'Qwen 3 1.7B', repoId: 'Qwen/Qwen3-1.7B', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 1.7, modelType: 'LLM', family: 'qwen', description: 'Qwen 3 with thinking mode support' },
  { name: 'Qwen 3 4B', repoId: 'Qwen/Qwen3-4B', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 4, modelType: 'LLM', family: 'qwen', description: 'Strong reasoning, laptop-friendly' },
  { name: 'Qwen 3 8B', repoId: 'Qwen/Qwen3-8B', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 8, modelType: 'LLM', family: 'qwen', description: 'Top-tier reasoning & code generation' },
  // Qwen 2.5 — AutoAWQ doesn't support Qwen2.5 attention architecture
  { name: 'Qwen 2.5 0.5B', repoId: 'Qwen/Qwen2.5-0.5B-Instruct', methods: ['GGUF', 'GPTQ', 'BitNet', 'MLX', 'FP16'], paramB: 0.5, modelType: 'LLM', family: 'qwen', description: 'Smallest Qwen, multilingual instruction' },
  { name: 'Qwen 2.5 1.5B', repoId: 'Qwen/Qwen2.5-1.5B-Instruct', methods: ['GGUF', 'GPTQ', 'BitNet', 'MLX', 'FP16'], paramB: 1.5, modelType: 'LLM', family: 'qwen', description: 'Efficient Qwen for mobile & edge' },
  { name: 'Qwen 2.5 3B', repoId: 'Qwen/Qwen2.5-3B-Instruct', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 3, modelType: 'LLM', family: 'qwen', description: 'Balanced quality & speed' },
  { name: 'Qwen 2.5 7B', repoId: 'Qwen/Qwen2.5-7B-Instruct', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 7, modelType: 'LLM', family: 'qwen', description: 'High quality multilingual & code' },
  // Phi
  { name: 'Phi-3 Mini 3.8B', repoId: 'microsoft/Phi-3-mini-4k-instruct', methods: ['GGUF', 'AWQ', 'GPTQ', 'MLX', 'FP16'], paramB: 3.8, modelType: 'LLM', family: 'phi', description: 'Microsoft SLM, strong at reasoning' },
  { name: 'Phi-4 Mini 3.8B', repoId: 'microsoft/Phi-4-mini-instruct', methods: ['GGUF', 'AWQ', 'GPTQ', 'MLX', 'FP16'], paramB: 3.8, modelType: 'LLM', family: 'phi', description: 'Latest Phi with enhanced math & code' },
  // Mistral
  { name: 'Mistral 7B', repoId: 'mistralai/Mistral-7B-v0.3', methods: ['GGUF', 'AWQ', 'GPTQ', 'MLX', 'FP16'], paramB: 7, modelType: 'LLM', family: 'mistral', description: 'Fast & high-quality general purpose' },
  { name: 'Mistral Small 24B', repoId: 'mistralai/Mistral-Small-24B-Instruct-2501', methods: ['GGUF', 'AWQ', 'GPTQ', 'MLX', 'FP16'], paramB: 24, modelType: 'LLM', family: 'mistral', description: 'Cloud-grade quality, fits on workstation' },
  // LiquidAI LFM — hybrid attention + state-space architecture
  { name: 'LFM 1.2B', repoId: 'LiquidAI/LFM2.5-1.2B-Instruct', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 1.2, modelType: 'LLM', family: 'lfm', description: 'Hybrid state-space, fast linear inference' },
  { name: 'LFM 1.2B Thinking', repoId: 'LiquidAI/LFM2.5-1.2B-Thinking', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 1.2, modelType: 'LLM', family: 'lfm', description: 'LFM with chain-of-thought reasoning' },
  // DeepSeek — Qwen-based distilled reasoning model
  { name: 'DeepSeek-R1 1.5B', repoId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 1.5, modelType: 'LLM', family: 'deepseek', description: 'Distilled reasoning, great for edge' },
  { name: 'DeepSeek-R1 7B', repoId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B', methods: ['GGUF', 'AWQ', 'GPTQ', 'MLX', 'FP16'], paramB: 7, modelType: 'LLM', family: 'deepseek', description: 'Strong reasoning with think blocks' },
  // --- Gated access (needs HF token) ---
  // Gemma 3 (latest) + Gemma 3n
  { name: 'Gemma 3n 2B', repoId: 'google/gemma-3n-E2B-it', methods: ['GGUF', 'GPTQ', 'FP16'], paramB: 2, modelType: 'LLM', family: 'gemma', description: 'Newest Gemma — optimized for on-device' },
  { name: 'Gemma 3 1B', repoId: 'google/gemma-3-1b-it', methods: ['GGUF', 'GPTQ', 'BitNet', 'MLX', 'FP16'], paramB: 1, modelType: 'LLM', family: 'gemma', description: 'Google compact model for mobile' },
  { name: 'Gemma 3 4B', repoId: 'google/gemma-3-4b-it', methods: ['GGUF', 'GPTQ', 'MLX', 'FP16'], paramB: 4, modelType: 'LLM', family: 'gemma', description: 'Strong multilingual & reasoning' },
  // Gemma 2
  { name: 'Gemma 2 2B', repoId: 'google/gemma-2-2b-it', methods: ['GGUF', 'AWQ', 'GPTQ', 'BitNet', 'MLX', 'FP16'], paramB: 2, modelType: 'LLM', family: 'gemma', description: 'Proven 2B model, battle-tested' },
  { name: 'Gemma 2 9B', repoId: 'google/gemma-2-9b-it', methods: ['GGUF', 'AWQ', 'GPTQ', 'MLX', 'FP16'], paramB: 9, modelType: 'LLM', family: 'gemma', description: 'Top-tier Google model for laptops' },
  // LLaMA
  { name: 'Llama 3.2 1B', repoId: 'meta-llama/Llama-3.2-1B-Instruct', methods: ['GGUF', 'AWQ', 'GPTQ', 'BitNet', 'MLX', 'FP16'], paramB: 1, modelType: 'LLM', family: 'llama', description: 'Meta compact model for edge & mobile' },
  { name: 'Llama 3.2 3B', repoId: 'meta-llama/Llama-3.2-3B-Instruct', methods: ['GGUF', 'AWQ', 'GPTQ', 'MLX', 'FP16'], paramB: 3, modelType: 'LLM', family: 'llama', description: 'Balanced Llama for mobile devices' },
  { name: 'Llama 3.1 8B', repoId: 'meta-llama/Llama-3.1-8B-Instruct', methods: ['GGUF', 'AWQ', 'GPTQ', 'MLX', 'FP16'], paramB: 8, modelType: 'LLM', family: 'llama', description: 'Industry standard 8B instruction model' },
  { name: 'Llama 3.3 70B', repoId: 'meta-llama/Llama-3.3-70B-Instruct', methods: ['GGUF', 'AWQ', 'GPTQ', 'MLX', 'FP16'], paramB: 70, modelType: 'LLM', family: 'llama', description: 'Frontier model, cloud deployment only' },
  // --- Vision-Language Models (VLMs) ---
  { name: 'Qwen 2.5 VL 3B', repoId: 'Qwen/Qwen2.5-VL-3B-Instruct', methods: ['GGUF', 'FP16'], paramB: 3, isVLM: true, modelType: 'VLM', family: 'qwen', description: 'Compact vision-language, image understanding' },
  { name: 'Qwen 2.5 VL 7B', repoId: 'Qwen/Qwen2.5-VL-7B-Instruct', methods: ['GGUF', 'FP16'], paramB: 7, isVLM: true, modelType: 'VLM', family: 'qwen', description: 'Strong VLM for OCR, charts & photos' },
  { name: 'SmolVLM 2.2B', repoId: 'HuggingFaceTB/SmolVLM-Instruct', methods: ['GGUF', 'FP16'], paramB: 2.2, isVLM: true, modelType: 'VLM', family: 'smollm', description: 'Tiny VLM for mobile image chat' },
  { name: 'Gemma 3 4B Vision', repoId: 'google/gemma-3-4b-it', methods: ['GGUF', 'FP16'], paramB: 4, isVLM: true, modelType: 'VLM', family: 'gemma', description: 'Google multimodal with image input' },
];

export const METHOD_BITS: Record<string, number[]> = {
  FP16: [16],
  GGUF: [2, 3, 4, 5, 8, 16],
  AWQ: [4, 8],
  GPTQ: [2, 3, 4, 8],
  BITNET: [1],
  MLX: [4, 8],
};

/** Get a flat list of model display names for use in agent prompts */
export function getModelNameList(): string[] {
  return SUPPORTED_MODELS.map(m => m.name);
}

/** Get annotated model names with "(latest)" on the newest model per family.
 *  The first model in each family group in SUPPORTED_MODELS is treated as latest. */
export function getModelNameListAnnotated(): string[] {
  const seenFamilies = new Set<string>();
  return SUPPORTED_MODELS.filter(m => m.modelType === 'LLM').map(m => {
    if (!seenFamilies.has(m.family)) {
      seenFamilies.add(m.family);
      return `${m.name} (latest)`;
    }
    return m.name;
  });
}

/** Build a name→repoId lookup map */
export function buildModelMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const m of SUPPORTED_MODELS) {
    map[m.name] = m.repoId;
  }
  return map;
}

/** Find a model by name (exact match) and return its metadata */
export function findModelByName(name: string): SupportedModel | undefined {
  return SUPPORTED_MODELS.find(m => m.name === name);
}

/** Find a model by repoId and return its metadata */
export function findModelByRepoId(repoId: string): SupportedModel | undefined {
  return SUPPORTED_MODELS.find(m => m.repoId === repoId);
}

/** Model type badge color mapping */
export const MODEL_TYPE_COLORS: Record<ModelType, string> = {
  LLM: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  VLM: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  'Vision-OD': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'Vision-Seg': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
};

/** Get unique model families from SUPPORTED_MODELS */
export function getModelFamilies(): string[] {
  return Array.from(new Set(SUPPORTED_MODELS.map(m => m.family))).sort();
}

/** Get unique model types from SUPPORTED_MODELS */
export function getModelTypes(): ModelType[] {
  return Array.from(new Set(SUPPORTED_MODELS.map(m => m.modelType))) as ModelType[];
}

export const DEVICE_CLASS_LIMITS = {
  edge: { maxMemory: 8, maxModelSize: 2, typicalTokensPerSec: 5 },
  mobile: { maxMemory: 8, maxModelSize: 4, typicalTokensPerSec: 15 },
  laptop: { maxMemory: 64, maxModelSize: 32, typicalTokensPerSec: 40 },
  cloud: { maxMemory: 640, maxModelSize: 300, typicalTokensPerSec: 200 },
} as const;

export const QUANTIZATION_PRESETS: QuantizationPreset[] = [
  {
    id: 'edge-ultra-compact',
    name: 'Edge Ultra Compact',
    description: 'Maximum compression for edge devices with severe memory constraints',
    method: 'GGUF',
    precision: 'INT2',
    bitsPerWeight: 2,
    groupSize: 64,
    targetDevice: 'edge',
    tradeoff: 'speed',
  },
  {
    id: 'mobile-balanced',
    name: 'Mobile Balanced',
    description: 'Balanced quality/size for mobile devices with NPU acceleration',
    method: 'AWQ',
    precision: 'INT4',
    bitsPerWeight: 4,
    groupSize: 128,
    targetDevice: 'mobile',
    tradeoff: 'balanced',
  },
  {
    id: 'laptop-quality',
    name: 'Laptop Quality',
    description: 'High quality with moderate compression for laptop GPUs',
    method: 'GPTQ',
    precision: 'INT8',
    bitsPerWeight: 8,
    groupSize: 128,
    targetDevice: 'laptop',
    tradeoff: 'quality',
  },
  {
    id: 'cloud-mixed',
    name: 'Cloud Mixed Precision',
    description: 'Mixed precision keeping attention layers at FP16 for maximum quality',
    method: 'AWQ',
    precision: 'MIXED',
    bitsPerWeight: 6,
    groupSize: 128,
    targetDevice: 'cloud',
    tradeoff: 'quality',
  },
  {
    id: 'apple-silicon-mlx',
    name: 'Apple Silicon MLX',
    description: 'Optimized for Apple M-series chips using unified memory and Metal GPU',
    method: 'MLX',
    precision: 'INT4',
    bitsPerWeight: 4,
    groupSize: 64,
    targetDevice: 'laptop',
    tradeoff: 'balanced',
  },
  {
    id: 'vptq-extreme',
    name: 'VPTQ Extreme Compression',
    description: 'Vector post-training quantization for extreme compression ratios',
    method: 'VPTQ',
    precision: 'INT3',
    bitsPerWeight: 3,
    groupSize: 256,
    targetDevice: 'edge',
    tradeoff: 'speed',
  },
];

export const DEFAULT_THRESHOLDS: MonitoringThresholds = {
  cpuUsage: { warning: 75, critical: 90 },
  memoryUsage: { warning: 80, critical: 95 },
  gpuTemp: { warning: 75, critical: 85 },
  latencyMs: { warning: 200, critical: 500 },
  tokensPerSec: { warning: 10, critical: 5 },
};

// ---- Finetuning Constants ----
export const FINETUNE_TYPES = [
  {
    id: 'qlora' as const,
    name: 'QLoRA',
    description: '4-bit quantized LoRA — lowest memory usage, great quality',
    badge: 'Recommended',
  },
  {
    id: 'lora' as const,
    name: 'LoRA',
    description: 'Low-Rank Adaptation — good balance of speed and quality',
    badge: '',
  },
  {
    id: 'full' as const,
    name: 'Full Finetuning',
    description: 'Full parameter training — best quality, requires most VRAM',
    badge: 'Advanced',
  },
];

export const POPULAR_DATASETS = [
  { id: 'yahma/alpaca-cleaned', name: 'Alpaca Cleaned', format: 'alpaca' as const, samples: 51760, description: 'General instruction following' },
  { id: 'databricks/databricks-dolly-15k', name: 'Dolly 15k', format: 'alpaca' as const, samples: 15011, description: 'Databricks instruction dataset' },
  { id: 'OpenAssistant/oasst1', name: 'OpenAssistant', format: 'sharegpt' as const, samples: 84437, description: 'Human-generated assistant conversations' },
  { id: 'teknium/OpenHermes-2.5', name: 'OpenHermes 2.5', format: 'sharegpt' as const, samples: 1000000, description: 'Large synthetic instruction dataset' },
  { id: 'cognitivecomputations/dolphin', name: 'Dolphin', format: 'sharegpt' as const, samples: 100000, description: 'Uncensored general purpose' },
  { id: 'custom', name: 'Upload Custom Dataset', format: 'custom' as const, samples: 0, description: 'Upload your own JSON/JSONL dataset' },
];

export const TRAINING_MODES = [
  {
    id: 'sft' as const,
    name: 'SFT',
    description: 'Supervised Fine-Tuning — learn from instruction/response pairs',
    badge: 'Recommended',
  },
  {
    id: 'grpo' as const,
    name: 'GRPO',
    description: 'Group Relative Policy Optimization — RL training with reward functions',
    badge: 'Advanced',
  },
];

export const GRPO_REWARD_TYPES = [
  { id: 'length' as const, name: 'Length', description: 'Reward longer, more detailed responses' },
  { id: 'correctness' as const, name: 'Correctness', description: 'Reward structured answers with answer tags' },
  { id: 'format' as const, name: 'Format', description: 'Reward well-structured output with lists & paragraphs' },
  { id: 'custom' as const, name: 'All Combined', description: 'Combine length + correctness + format rewards' },
];

export const FINETUNE_DEFAULTS = {
  epochs: 3,
  batchSize: 4,
  learningRate: 2e-4,
  loraRank: 16,
  loraAlpha: 32,
  maxSeqLength: 2048,
  finetuningType: 'qlora' as const,
  mergeAdapters: false,
  trainingMode: 'sft' as const,
  rewardType: 'length' as const,
  numGenerations: 4,
  grpoBeta: 0.1,
};

// ---- VLM Fine-tuning Datasets (curated, high-quality) ----
export const VLM_DATASETS = [
  { id: 'lmms-lab/DocVQA', name: 'DocVQA', format: 'sharegpt' as const, samples: 50000, description: 'Document visual question answering' },
  { id: 'facebook/textvqa', name: 'TextVQA', format: 'sharegpt' as const, samples: 45336, description: 'Reading and reasoning about text in images' },
  { id: 'HuggingFaceM4/the_cauldron', name: 'The Cauldron', format: 'sharegpt' as const, samples: 50000000, description: 'Multi-task multimodal — use max_samples to subset' },
  { id: 'custom', name: 'Upload Custom Dataset', format: 'custom' as const, samples: 0, description: 'Upload JSON/JSONL with image conversations' },
  { id: 'huggingface', name: 'HuggingFace Dataset ID', format: 'custom' as const, samples: 0, description: 'Enter any org/dataset-name from HuggingFace' },
];

// ---- VLM Fine-tuning Defaults (auto-applied when VLM model selected) ----
export const VLM_FINETUNE_DEFAULTS = {
  epochs: 3,
  batchSize: 2,
  learningRate: 2e-5,
  loraRank: 16,
  loraAlpha: 16,
  maxSeqLength: 1024,
  finetuningType: 'qlora' as const,
  mergeAdapters: false,
  trainingMode: 'sft' as const,
  rewardType: 'length' as const,
  numGenerations: 4,
  grpoBeta: 0.1,
  maxSamples: 1000,
};

// ---- Avatar Options ----
export const AVATAR_OPTIONS = [
  { id: 'male-1', label: 'Atlas', src: '/avatars/male-1.svg', color: 'border-blue-500 shadow-blue-500/30' },
  { id: 'male-2', label: 'Nova', src: '/avatars/male-2.svg', color: 'border-violet-500 shadow-violet-500/30' },
  { id: 'female-1', label: 'Aurora', src: '/avatars/female-1.svg', color: 'border-emerald-500 shadow-emerald-500/30' },
  { id: 'female-2', label: 'Ember', src: '/avatars/female-2.svg', color: 'border-orange-500 shadow-orange-500/30' },
  { id: 'male-3', label: 'Kai', src: '/avatars/male-3.svg', color: 'border-cyan-500 shadow-cyan-500/30' },
  { id: 'male-4', label: 'Zion', src: '/avatars/male-4.svg', color: 'border-rose-500 shadow-rose-500/30' },
  { id: 'female-3', label: 'Luna', src: '/avatars/female-3.svg', color: 'border-indigo-500 shadow-indigo-500/30' },
  { id: 'female-4', label: 'Sage', src: '/avatars/female-4.svg', color: 'border-teal-500 shadow-teal-500/30' },
] as const;

const VALID_AVATAR_IDS: Set<string> = new Set(AVATAR_OPTIONS.map(a => a.id));

export function getAvatarSrc(avatarId: string | undefined): string | null {
  if (!avatarId || !VALID_AVATAR_IDS.has(avatarId)) return null;
  return AVATAR_OPTIONS.find(a => a.id === avatarId)?.src ?? null;
}

export function isValidAvatarId(avatarId: string): boolean {
  return VALID_AVATAR_IDS.has(avatarId);
}

export const AGENT_COLORS: Record<string, string> = {
  research: '#3b82f6',
  reasoning: '#8b5cf6',
  critic: '#ef4444',
  orchestrator: '#10b981',
};

export const AGENT_DESCRIPTIONS: Record<string, string> = {
  research: 'Analyzes hardware capabilities, model requirements, and deployment constraints',
  reasoning: 'Develops optimization strategies based on research findings',
  critic: 'Evaluates proposed strategies for feasibility and potential issues',
  orchestrator: 'Synthesizes agent outputs into actionable deployment configuration',
};

// ===== VISION CONSTANTS =====
export const SUPPORTED_VISION_MODELS = [
  // Object Detection
  { name: 'YOLO26 Nano', modelId: 'yolo26n.pt', task: 'detect' as const, paramM: 2.5, defaultImgSize: 640, cocoMap: 40.1, description: 'Latest & fastest — ideal for mobile & edge' },
  { name: 'YOLO26 Small', modelId: 'yolo26s.pt', task: 'detect' as const, paramM: 9.5, defaultImgSize: 640, cocoMap: 47.8, description: 'Best accuracy/speed balance for laptops' },
  { name: 'YOLO11 Nano', modelId: 'yolo11n.pt', task: 'detect' as const, paramM: 2.6, defaultImgSize: 640, cocoMap: 39.5, description: 'Battle-tested — 1+ year in production' },
  // Instance Segmentation
  { name: 'YOLO26 Nano Seg', modelId: 'yolo26n-seg.pt', task: 'segment' as const, paramM: 3, defaultImgSize: 640, cocoMap: 33, description: 'Fastest edge segmentation — crisp masks' },
  { name: 'YOLO26 Small Seg', modelId: 'yolo26s-seg.pt', task: 'segment' as const, paramM: 10, defaultImgSize: 640, cocoMap: 39, description: 'Higher quality masks for larger devices' },
  { name: 'YOLO11 Nano Seg', modelId: 'yolo11n-seg.pt', task: 'segment' as const, paramM: 2.8, defaultImgSize: 640, cocoMap: 32, description: 'Proven segmentation — stable & reliable' },
];

export const VISION_EXPORT_FORMATS = [
  { id: 'onnx' as const, name: 'ONNX', description: 'Universal — CPU & CUDA, cross-platform', badge: 'Recommended', precisions: ['fp32', 'fp16'] as const },
  { id: 'engine' as const, name: 'TensorRT', description: 'NVIDIA GPU — fastest inference', badge: 'NVIDIA', precisions: ['fp16', 'int8'] as const },
  { id: 'coreml' as const, name: 'CoreML', description: 'iOS & macOS — Neural Engine', badge: 'Apple', precisions: ['fp16', 'int8'] as const },
  { id: 'tflite' as const, name: 'TF Lite', description: 'Android & embedded devices', badge: 'Android', precisions: ['fp16', 'int8'] as const },
  { id: 'openvino' as const, name: 'OpenVINO', description: 'Intel CPU, GPU & NPU', badge: 'Intel', precisions: ['fp16', 'int8'] as const },
  { id: 'ncnn' as const, name: 'NCNN', description: 'ARM mobile — Vulkan GPU', badge: 'ARM', precisions: ['fp16'] as const },
];

// ===== VISION TRAINING CONSTANTS =====
export const VISION_TRAIN_DEFAULTS = {
  epochs: 50,
  batchSize: 16,
  imgSize: 640,
  learningRate: 0.01,
  optimizer: 'auto' as const,
  freeze: 0,
  augment: true,
  patience: 10,
  resume: false,
};

export const VISION_OPTIMIZER_OPTIONS = [
  { value: 'auto', label: 'Auto', description: 'Ultralytics selects the best optimizer' },
  { value: 'SGD', label: 'SGD', description: 'Stochastic gradient descent with momentum' },
  { value: 'Adam', label: 'Adam', description: 'Adaptive moment estimation' },
  { value: 'AdamW', label: 'AdamW', description: 'Adam with decoupled weight decay' },
];

export const VISION_BATCH_OPTIONS = [4, 8, 16, 32, 64];
export const VISION_IMGSIZE_OPTIONS = [320, 416, 512, 640, 800, 1024];
export const VISION_EPOCH_OPTIONS = [10, 25, 50, 100, 200, 300];
