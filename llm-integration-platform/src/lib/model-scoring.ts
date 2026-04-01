/**
 * Model Scoring Engine — deterministic hardware-aware model ranking.
 *
 * Ported from llmfit (Rust) reference implementation.
 * Scores every model in the catalog against a device's hardware,
 * selecting the best quantization that fits and computing multi-dimensional scores.
 */

import { DeviceInput } from './types';
import {
  SUPPORTED_MODELS,
  SupportedModel,
  RAM_SAFETY_FACTOR,
  lookupGPUBandwidth,
} from './constants';

// ── Types ────────────────────────────────────────────────────────────

export type FitLevel = 'perfect' | 'good' | 'marginal' | 'too_tight';
export type RunMode = 'gpu' | 'moe_offload' | 'cpu_offload' | 'cpu_only';
export type UseCase = 'general' | 'coding' | 'reasoning' | 'chat' | 'multimodal' | 'embedding';

export interface ScoreComponents {
  quality: number;
  speed: number;
  fit: number;
  context: number;
}

export interface ModelFit {
  modelName: string;
  repoId: string;
  paramB: number;
  family: string;
  quantization: string;
  bitsPerWeight: number;
  method: string;
  estimatedMemoryGB: number;
  availableMemoryGB: number;
  memoryUtilization: number;
  fitLevel: FitLevel;
  estimatedTPS: number;
  runMode: RunMode;
  scores: ScoreComponents;
  compositeScore: number;
  isMoE: boolean;
  activeParamsB?: number;
}

export interface HardwareProfile {
  totalRAMGB: number;
  usableRAMGB: number;
  gpuName: string | null;
  gpuVRAMGB: number | null;
  gpuBandwidthGBs: number | null;
  isAppleSilicon: boolean;
  isUnifiedMemory: boolean;
  cpuCores: number | null;
  deviceType: string;
}

// ── Constants (ported from llmfit models.rs) ─────────────────────────

const GGUF_QUANT_HIERARCHY = ['Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'Q3_K_M', 'Q2_K'] as const;
const MLX_QUANT_HIERARCHY = ['mlx-8bit', 'mlx-4bit'] as const;
const AWQ_QUANT_HIERARCHY = ['AWQ-8bit', 'AWQ-4bit'] as const;
const GPTQ_QUANT_HIERARCHY = ['GPTQ-8bit', 'GPTQ-4bit'] as const;

/** Bytes per parameter — used for memory estimation */
const QUANT_BPP: Record<string, number> = {
  'FP16': 2.0,
  'Q8_0': 1.05,
  'Q6_K': 0.80,
  'Q5_K_M': 0.68,
  'Q4_K_M': 0.58,
  'Q3_K_M': 0.48,
  'Q2_K': 0.37,
  'mlx-8bit': 1.0,
  'mlx-4bit': 0.55,
  'AWQ-4bit': 0.5,
  'AWQ-8bit': 1.0,
  'GPTQ-4bit': 0.5,
  'GPTQ-8bit': 1.0,
  'BitNet-1bit': 0.13,
};

/** Bytes per parameter — used for bandwidth-based tok/s estimation */
const QUANT_BYTES_PER_PARAM: Record<string, number> = {
  'FP16': 2.0,
  'Q8_0': 1.0,
  'Q6_K': 0.75,
  'Q5_K_M': 0.625,
  'Q4_K_M': 0.5,
  'Q3_K_M': 0.375,
  'Q2_K': 0.25,
  'mlx-4bit': 0.5,
  'mlx-8bit': 1.0,
  'AWQ-4bit': 0.5,
  'AWQ-8bit': 1.0,
  'GPTQ-4bit': 0.5,
  'GPTQ-8bit': 1.0,
  'BitNet-1bit': 0.125,
};

/** Speed multiplier relative to Q5_K_M = 1.0 baseline */
const QUANT_SPEED_MULT: Record<string, number> = {
  'FP16': 0.6,
  'Q8_0': 0.8,
  'Q6_K': 0.95,
  'Q5_K_M': 1.0,
  'Q4_K_M': 1.15,
  'Q3_K_M': 1.25,
  'Q2_K': 1.35,
  'mlx-4bit': 1.15,
  'mlx-8bit': 0.85,
  'AWQ-4bit': 1.2,
  'AWQ-8bit': 0.85,
  'GPTQ-4bit': 1.2,
  'GPTQ-8bit': 0.85,
  'BitNet-1bit': 1.5,
};

/** Quality penalty for quantization */
const QUANT_QUALITY_PENALTY: Record<string, number> = {
  'FP16': 0,
  'Q8_0': 0,
  'Q6_K': -1,
  'Q5_K_M': -2,
  'Q4_K_M': -5,
  'Q3_K_M': -8,
  'Q2_K': -12,
  'mlx-8bit': 0,
  'mlx-4bit': -4,
  'AWQ-4bit': -3,
  'AWQ-8bit': 0,
  'GPTQ-4bit': -3,
  'GPTQ-8bit': 0,
  'BitNet-1bit': -15,
};

/** Use-case scoring weights: [quality, speed, fit, context] */
const USE_CASE_WEIGHTS: Record<UseCase, [number, number, number, number]> = {
  general:    [0.45, 0.30, 0.15, 0.10],
  coding:     [0.50, 0.20, 0.15, 0.15],
  reasoning:  [0.55, 0.15, 0.15, 0.15],
  chat:       [0.40, 0.35, 0.15, 0.10],
  multimodal: [0.50, 0.20, 0.15, 0.15],
  embedding:  [0.30, 0.40, 0.20, 0.10],
};

/** Family reputation bumps */
const FAMILY_QUALITY_BUMP: Record<string, number> = {
  deepseek: 3, qwen: 2, llama: 2, mistral: 1, gemma: 1, smollm: 0, phi: 0, lfm: 1,
};

/** Quantization key → display bits */
const QUANT_BITS: Record<string, number> = {
  'FP16': 16, 'Q8_0': 8, 'Q6_K': 6, 'Q5_K_M': 5, 'Q4_K_M': 4, 'Q3_K_M': 3, 'Q2_K': 2,
  'mlx-8bit': 8, 'mlx-4bit': 4,
  'AWQ-4bit': 4, 'AWQ-8bit': 8,
  'GPTQ-4bit': 4, 'GPTQ-8bit': 8,
  'BitNet-1bit': 1,
};

// ── Helper functions ─────────────────────────────────────────────────

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function baseQualityScore(paramB: number): number {
  if (paramB < 1) return 30;
  if (paramB < 3) return 45;
  if (paramB < 7) return 60;
  if (paramB < 10) return 75;
  if (paramB < 20) return 82;
  if (paramB < 40) return 89;
  return 95;
}

function detectAppleSilicon(device: DeviceInput): boolean {
  const name = (device.deviceName + ' ' + (device.gpuInfo || '')).toLowerCase();
  return /\b(m[1-9]\b|m\d+ (pro|max|ultra)|apple silicon|mac|macbook|imac|mac mini|mac pro|mac studio|iphone|ipad)\b/i.test(name);
}

function extractGPUVRAM(gpuInfo: string): number | null {
  if (!gpuInfo) return null;
  const match = gpuInfo.match(/(\d+)\s*GB/i);
  return match ? parseInt(match[1], 10) : null;
}

// ── Core functions ───────────────────────────────────────────────────

export function buildHardwareProfile(device: DeviceInput): HardwareProfile {
  const isApple = detectAppleSilicon(device);
  const bandwidth = lookupGPUBandwidth(device.gpuInfo || '');
  const gpuVRAM = device.gpuVRAMGB ?? extractGPUVRAM(device.gpuInfo || '');

  return {
    totalRAMGB: device.ramGB,
    usableRAMGB: device.ramGB * RAM_SAFETY_FACTOR,
    gpuName: device.gpuInfo || null,
    gpuVRAMGB: isApple ? device.ramGB : gpuVRAM,
    gpuBandwidthGBs: bandwidth,
    isAppleSilicon: isApple,
    isUnifiedMemory: isApple,
    cpuCores: device.cpuCores ?? null,
    deviceType: device.deviceType,
  };
}

export function estimateMemoryGB(paramB: number, quantKey: string, contextTokens?: number): number {
  const bpp = QUANT_BPP[quantKey] ?? 0.58;
  const modelMem = paramB * bpp;
  const ctx = contextTokens ?? 4096;
  const kvCache = 0.000008 * paramB * ctx;
  const overhead = 0.5;
  return modelMem + kvCache + overhead;
}

export function estimateTPS(
  paramB: number,
  quantKey: string,
  hw: HardwareProfile,
  runMode: RunMode,
): number {
  // Bandwidth-based estimation (preferred)
  if (runMode !== 'cpu_only' && hw.gpuBandwidthGBs) {
    const bytesPerParam = QUANT_BYTES_PER_PARAM[quantKey] ?? 0.5;
    const modelGB = paramB * bytesPerParam;
    const efficiency = 0.55;
    const rawTPS = (hw.gpuBandwidthGBs / modelGB) * efficiency;
    const modeFactor =
      runMode === 'gpu' ? 1.0 :
      runMode === 'moe_offload' ? 0.8 :
      runMode === 'cpu_offload' ? 0.5 : 1.0;
    return Math.max(rawTPS * modeFactor, 0.1);
  }

  // Fallback: fixed-constant approach
  const hasGPU = !!hw.gpuName && hw.gpuName.toLowerCase() !== 'none';
  let k: number;
  if (hw.isAppleSilicon) {
    k = 160;
  } else if (hasGPU) {
    k = 220;
  } else {
    k = 70;
  }

  let base = k / Math.max(paramB, 0.1);
  base *= QUANT_SPEED_MULT[quantKey] ?? 1.0;

  if (hw.cpuCores && hw.cpuCores >= 8) {
    base *= 1.1;
  }

  if (runMode === 'cpu_only') {
    base *= 0.3;
  } else if (runMode === 'cpu_offload') {
    base *= 0.5;
  }

  return Math.max(base, 0.1);
}

export function selectBestQuantization(
  model: SupportedModel,
  hw: HardwareProfile,
): { quantKey: string; bitsPerWeight: number; method: string; memGB: number } | null {
  const paramB = model.paramB ?? 1;
  const methods = model.methods;
  const ctx = model.contextLength ?? 4096;
  // Cap context for estimation to avoid oversized KV cache estimates
  const estCtx = Math.min(ctx, 8192);

  type QuantEntry = { quantKey: string; method: string };
  const candidates: QuantEntry[] = [];

  // Build ordered candidate list based on platform preference
  if (hw.isAppleSilicon && methods.includes('MLX')) {
    for (const q of MLX_QUANT_HIERARCHY) candidates.push({ quantKey: q, method: 'MLX' });
  }
  if (methods.includes('GGUF')) {
    for (const q of GGUF_QUANT_HIERARCHY) candidates.push({ quantKey: q, method: 'GGUF' });
  }
  if (methods.includes('AWQ')) {
    for (const q of AWQ_QUANT_HIERARCHY) candidates.push({ quantKey: q, method: 'AWQ' });
  }
  if (methods.includes('GPTQ')) {
    for (const q of GPTQ_QUANT_HIERARCHY) candidates.push({ quantKey: q, method: 'GPTQ' });
  }
  if (methods.includes('FP16')) {
    candidates.push({ quantKey: 'FP16', method: 'FP16' });
  }
  if (methods.includes('BitNet')) {
    candidates.push({ quantKey: 'BitNet-1bit', method: 'BitNet' });
  }

  // Sort by quality: FP16 first, then 8-bit, then 4-bit, etc.
  // Within same bits, prefer MLX on Apple Silicon
  candidates.sort((a, b) => {
    const bitsA = QUANT_BITS[a.quantKey] ?? 4;
    const bitsB = QUANT_BITS[b.quantKey] ?? 4;
    if (bitsA !== bitsB) return bitsB - bitsA; // higher bits = better quality
    // If same bits, prefer MLX on Apple Silicon
    if (hw.isAppleSilicon) {
      if (a.method === 'MLX' && b.method !== 'MLX') return -1;
      if (b.method === 'MLX' && a.method !== 'MLX') return 1;
    }
    return 0;
  });

  // Pick the best quality that fits
  for (const { quantKey, method } of candidates) {
    const memGB = estimateMemoryGB(paramB, quantKey, estCtx);
    if (memGB <= hw.usableRAMGB) {
      return {
        quantKey,
        bitsPerWeight: QUANT_BITS[quantKey] ?? 4,
        method,
        memGB,
      };
    }
  }

  // Try with halved context
  const halfCtx = Math.floor(estCtx / 2);
  if (halfCtx >= 1024) {
    for (const { quantKey, method } of candidates) {
      const memGB = estimateMemoryGB(paramB, quantKey, halfCtx);
      if (memGB <= hw.usableRAMGB) {
        return {
          quantKey,
          bitsPerWeight: QUANT_BITS[quantKey] ?? 4,
          method,
          memGB,
        };
      }
    }
  }

  return null;
}

function determineRunMode(hw: HardwareProfile, memGB: number): RunMode {
  const hasGPU = !!hw.gpuName && hw.gpuName.toLowerCase() !== 'none';
  if (hw.isAppleSilicon) {
    // Unified memory: all GPU
    return 'gpu';
  }
  if (hasGPU && hw.gpuVRAMGB) {
    if (memGB <= hw.gpuVRAMGB) return 'gpu';
    if (memGB <= hw.gpuVRAMGB * 1.5) return 'cpu_offload';
  }
  if (hasGPU) return 'gpu';
  return 'cpu_only';
}

export function scoreFitLevel(memRequired: number, memAvailable: number, runMode: RunMode): FitLevel {
  if (memRequired > memAvailable) return 'too_tight';
  if (runMode === 'cpu_only') return 'marginal';
  if (runMode === 'gpu' && memAvailable >= memRequired * 1.2) return 'perfect';
  if (memAvailable >= memRequired * 1.2) return 'good';
  return 'marginal';
}

export function scoreQuality(paramB: number, family: string, quantKey: string, useCase: UseCase): number {
  const base = baseQualityScore(paramB);
  const bump = FAMILY_QUALITY_BUMP[family] ?? 0;
  const penalty = QUANT_QUALITY_PENALTY[quantKey] ?? 0;
  const isCodingModel = family === 'qwen' || family === 'deepseek';
  const taskBump =
    (useCase === 'coding' && isCodingModel) ? 6 :
    (useCase === 'reasoning' && paramB >= 7) ? 5 : 0;
  return clamp(base + bump + penalty + taskBump, 0, 100);
}

export function scoreSpeed(estimatedTPS: number, useCase: UseCase): number {
  const targets: Record<UseCase, number> = {
    general: 40, coding: 40, chat: 40, reasoning: 25, multimodal: 40, embedding: 200,
  };
  return clamp((estimatedTPS / targets[useCase]) * 100, 0, 100);
}

export function scoreFit(memRequired: number, memAvailable: number): number {
  if (memAvailable <= 0 || memRequired > memAvailable) return 0;
  const ratio = memRequired / memAvailable;
  if (ratio <= 0.5) return 60 + (ratio / 0.5) * 40;
  if (ratio <= 0.8) return 100;
  if (ratio <= 0.9) return 70;
  return 50;
}

export function scoreContext(contextLength: number, useCase: UseCase): number {
  const targets: Record<UseCase, number> = {
    general: 4096, chat: 4096, coding: 8192, reasoning: 8192, multimodal: 4096, embedding: 512,
  };
  const target = targets[useCase];
  if (contextLength >= target) return 100;
  if (contextLength >= target / 2) return 70;
  return 30;
}

export function computeCompositeScore(scores: ScoreComponents, useCase: UseCase): number {
  const w = USE_CASE_WEIGHTS[useCase];
  const raw = scores.quality * w[0] + scores.speed * w[1] + scores.fit * w[2] + scores.context * w[3];
  return Math.round(raw * 10) / 10;
}

// ── Main entry point ─────────────────────────────────────────────────

export function scoreAllModels(device: DeviceInput, useCase?: UseCase): ModelFit[] {
  const hw = buildHardwareProfile(device);
  const uc = useCase ?? 'general';
  const results: ModelFit[] = [];

  for (const model of SUPPORTED_MODELS) {
    if (model.modelType !== 'LLM' && model.modelType !== 'VLM') continue;
    const paramB = model.paramB ?? 1;

    const bestQuant = selectBestQuantization(model, hw);
    if (!bestQuant) continue;

    const runMode = determineRunMode(hw, bestQuant.memGB);
    const tps = estimateTPS(paramB, bestQuant.quantKey, hw, runMode);
    const fitLevel = scoreFitLevel(bestQuant.memGB, hw.usableRAMGB, runMode);

    const scores: ScoreComponents = {
      quality: scoreQuality(paramB, model.family, bestQuant.quantKey, uc),
      speed: scoreSpeed(tps, uc),
      fit: scoreFit(bestQuant.memGB, hw.usableRAMGB),
      context: scoreContext(model.contextLength ?? 4096, uc),
    };
    const composite = computeCompositeScore(scores, uc);

    results.push({
      modelName: model.name,
      repoId: model.repoId,
      paramB,
      family: model.family,
      quantization: bestQuant.quantKey,
      bitsPerWeight: bestQuant.bitsPerWeight,
      method: bestQuant.method,
      estimatedMemoryGB: Math.round(bestQuant.memGB * 100) / 100,
      availableMemoryGB: Math.round(hw.usableRAMGB * 100) / 100,
      memoryUtilization: Math.round((bestQuant.memGB / hw.usableRAMGB) * 1000) / 1000,
      fitLevel,
      estimatedTPS: Math.round(tps * 10) / 10,
      runMode,
      scores,
      compositeScore: composite,
      isMoE: model.isMoE ?? false,
      activeParamsB: model.activeExperts ? paramB * (model.activeExperts / (model.numExperts ?? 1)) : undefined,
    });
  }

  // Sort: compositeScore DESC, then fitLevel priority
  const fitOrder: Record<FitLevel, number> = { perfect: 0, good: 1, marginal: 2, too_tight: 3 };
  results.sort((a, b) => {
    if (b.compositeScore !== a.compositeScore) return b.compositeScore - a.compositeScore;
    return fitOrder[a.fitLevel] - fitOrder[b.fitLevel];
  });

  return results;
}

// ── Formatting for agent prompts ─────────────────────────────────────

export function formatScoredModelsForPrompt(fits: ModelFit[], topN?: number): string {
  const top = fits.slice(0, topN ?? 15);
  if (top.length === 0) return 'No models fit this device at any quantization level.';

  const hw = top[0];
  const lines: string[] = [];
  lines.push(`Hardware: ${hw.availableMemoryGB}GB usable RAM (${Math.round(RAM_SAFETY_FACTOR * 100)}% of total)`);
  lines.push('');
  lines.push('Pre-computed model rankings (deterministic, based on actual hardware):');
  lines.push('');
  lines.push(' #  Model                    Method     Mem     ~TPS  Score  Fit');
  lines.push(' ─  ────────────────────────  ─────────  ──────  ────  ─────  ────────');

  for (let i = 0; i < top.length; i++) {
    const m = top[i];
    const num = String(i + 1).padStart(2);
    const name = m.modelName.padEnd(24).slice(0, 24);
    const method = `${m.bitsPerWeight}-bit ${m.method}`.padEnd(9).slice(0, 9);
    const mem = `${m.estimatedMemoryGB.toFixed(1)}GB`.padStart(6);
    const tps = `~${Math.round(m.estimatedTPS)}`.padStart(4);
    const score = m.compositeScore.toFixed(1).padStart(5);
    const fit = m.fitLevel.charAt(0).toUpperCase() + m.fitLevel.slice(1);
    lines.push(`${num}  ${name}  ${method}  ${mem}  ${tps}  ${score}  ${fit}`);
  }

  lines.push('');
  lines.push(`Memory formula: (params × bytes_per_param) + KV cache + 0.5GB overhead`);
  lines.push(`Safety margin: only ${Math.round(RAM_SAFETY_FACTOR * 100)}% of device RAM is usable for the model`);

  return lines.join('\n');
}

export function getHardwareRequirements(
  modelName: string,
  method: string,
  bits: number,
): { minRAMGB: number; recommendedRAMGB: number; minVRAMGB?: number } | null {
  const model = SUPPORTED_MODELS.find(m => m.name === modelName);
  if (!model) return null;

  const quantKey =
    method === 'GGUF' ? (bits === 8 ? 'Q8_0' : bits === 4 ? 'Q4_K_M' : bits === 3 ? 'Q3_K_M' : bits === 2 ? 'Q2_K' : bits === 5 ? 'Q5_K_M' : 'Q4_K_M') :
    method === 'AWQ' ? `AWQ-${bits}bit` :
    method === 'GPTQ' ? `GPTQ-${bits}bit` :
    method === 'MLX' ? `mlx-${bits}bit` :
    method === 'FP16' ? 'FP16' :
    'Q4_K_M';

  const paramB = model.paramB ?? 1;
  const memGB = estimateMemoryGB(paramB, quantKey);

  return {
    minRAMGB: Math.round(memGB / RAM_SAFETY_FACTOR * 10) / 10,
    recommendedRAMGB: Math.round((memGB * 1.3 / RAM_SAFETY_FACTOR) * 10) / 10,
    minVRAMGB: Math.round(memGB * 10) / 10,
  };
}
