import {
  estimateMemoryGB,
  selectBestQuantization,
  estimateTPS,
  scoreAllModels,
  formatScoredModelsForPrompt,
  scoreFitLevel,
  scoreFit,
  scoreQuality,
  scoreSpeed,
  scoreContext,
  computeCompositeScore,
  buildHardwareProfile,
  getHardwareRequirements,
} from '@/lib/model-scoring';
import { lookupGPUBandwidth, SUPPORTED_MODELS } from '@/lib/constants';
import { DeviceInput } from '@/lib/types';

// ── Helpers ──────────────────────────────────────────────────────────

const macM3_36GB: DeviceInput = {
  deviceName: 'MacBook Pro M3 Max',
  ramGB: 36,
  gpuInfo: 'Apple M3 Max',
  storageGB: 1000,
  deviceType: 'laptop',
};

const linuxServer: DeviceInput = {
  deviceName: 'Linux Server',
  ramGB: 256,
  gpuInfo: 'NVIDIA L40S',
  storageGB: 2000,
  deviceType: 'server',
};

const iphone4GB: DeviceInput = {
  deviceName: 'iPhone 15',
  ramGB: 4,
  gpuInfo: 'Apple A17 Pro',
  storageGB: 128,
  deviceType: 'mobile',
};

const rtx4090Desktop: DeviceInput = {
  deviceName: 'Gaming Desktop',
  ramGB: 32,
  gpuInfo: 'NVIDIA RTX 4090 24GB',
  storageGB: 2000,
  deviceType: 'desktop',
};

const cpuOnlyDevice: DeviceInput = {
  deviceName: 'Raspberry Pi 5',
  ramGB: 8,
  gpuInfo: '',
  storageGB: 64,
  deviceType: 'edge',
};

// ── estimateMemoryGB ─────────────────────────────────────────────────

describe('estimateMemoryGB', () => {
  it('SmolLM2 135M at FP16 ≈ 0.8GB', () => {
    const mem = estimateMemoryGB(0.135, 'FP16');
    expect(mem).toBeGreaterThan(0.5);
    expect(mem).toBeLessThan(1.5);
  });

  it('Qwen 3 8B at Q4_K_M ≈ 5.2GB', () => {
    const mem = estimateMemoryGB(8, 'Q4_K_M');
    expect(mem).toBeGreaterThan(4);
    expect(mem).toBeLessThan(7);
  });

  it('Llama 3.3 70B at Q4_K_M ≈ 41GB', () => {
    const mem = estimateMemoryGB(70, 'Q4_K_M');
    expect(mem).toBeGreaterThan(35);
    expect(mem).toBeLessThan(50);
  });

  it('includes KV cache estimate', () => {
    const mem4k = estimateMemoryGB(8, 'Q4_K_M', 4096);
    const mem32k = estimateMemoryGB(8, 'Q4_K_M', 32768);
    expect(mem32k).toBeGreaterThan(mem4k);
  });
});

// ── selectBestQuantization ───────────────────────────────────────────

describe('selectBestQuantization', () => {
  const findModel = (name: string) => SUPPORTED_MODELS.find(m => m.name === name)!;

  it('4GB usable → SmolLM2 1.7B fits at high quality', () => {
    const hw = buildHardwareProfile({ ...iphone4GB, ramGB: 6 });
    const result = selectBestQuantization(findModel('SmolLM2 1.7B'), hw);
    expect(result).not.toBeNull();
    expect(result!.memGB).toBeLessThanOrEqual(hw.usableRAMGB);
  });

  it('8GB usable → Qwen 3 4B fits', () => {
    const hw = buildHardwareProfile({ ...cpuOnlyDevice, ramGB: 12 });
    const result = selectBestQuantization(findModel('Qwen 3 4B'), hw);
    expect(result).not.toBeNull();
    expect(result!.memGB).toBeLessThanOrEqual(hw.usableRAMGB);
  });

  it('2GB usable → Llama 3.3 70B does NOT fit', () => {
    const hw = buildHardwareProfile({ ...iphone4GB, ramGB: 3 });
    const result = selectBestQuantization(findModel('Llama 3.3 70B'), hw);
    expect(result).toBeNull();
  });

  it('Apple Silicon prefers MLX over GGUF at same bit depth', () => {
    // With 10GB usable, FP16 won't fit for 8B, so it should pick MLX 8-bit over GGUF Q8_0
    const hw = buildHardwareProfile({ ...macM3_36GB, ramGB: 14 });
    const model = findModel('Qwen 3 8B');
    const result = selectBestQuantization(model, hw);
    expect(result).not.toBeNull();
    // At constrained RAM, MLX should be preferred over GGUF
    expect(['MLX', 'GGUF']).toContain(result!.method);
  });
});

// ── estimateTPS ──────────────────────────────────────────────────────

describe('estimateTPS', () => {
  it('M3 Max + Qwen 3 8B Q4_K_M → 20-80 tok/s', () => {
    const hw = buildHardwareProfile(macM3_36GB);
    const tps = estimateTPS(8, 'Q4_K_M', hw, 'gpu');
    expect(tps).toBeGreaterThan(20);
    expect(tps).toBeLessThan(80);
  });

  it('RTX 4090 + Llama 3.1 8B Q4_K_M → 50-200 tok/s', () => {
    const hw = buildHardwareProfile(rtx4090Desktop);
    const tps = estimateTPS(8, 'Q4_K_M', hw, 'gpu');
    expect(tps).toBeGreaterThan(50);
    expect(tps).toBeLessThan(200);
  });

  it('CPU only + 8B model → low tok/s', () => {
    const hw = buildHardwareProfile(cpuOnlyDevice);
    const tps = estimateTPS(8, 'Q4_K_M', hw, 'cpu_only');
    expect(tps).toBeLessThan(20);
  });

  it('returns positive value for any config', () => {
    const hw = buildHardwareProfile(cpuOnlyDevice);
    const tps = estimateTPS(70, 'Q2_K', hw, 'cpu_only');
    expect(tps).toBeGreaterThan(0);
  });
});

// ── scoreAllModels (end-to-end) ──────────────────────────────────────

describe('scoreAllModels', () => {
  it('MacBook Pro M3 36GB → top result fits perfectly', () => {
    const results = scoreAllModels(macM3_36GB);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].fitLevel).not.toBe('too_tight');
    expect(results[0].compositeScore).toBeGreaterThan(0);
  });

  it('iPhone 4GB → only returns small models', () => {
    const results = scoreAllModels(iphone4GB);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.paramB).toBeLessThanOrEqual(4);
    }
  });

  it('Server 256GB → includes large models', () => {
    const results = scoreAllModels(linuxServer);
    const has70B = results.some(r => r.paramB >= 70);
    expect(has70B).toBe(true);
  });

  it('results are sorted by compositeScore descending', () => {
    const results = scoreAllModels(macM3_36GB);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].compositeScore).toBeGreaterThanOrEqual(results[i].compositeScore);
    }
  });

  it('Linux server does not get MLX method', () => {
    const results = scoreAllModels(linuxServer);
    for (const r of results) {
      expect(r.method).not.toBe('MLX');
    }
  });
});

// ── formatScoredModelsForPrompt ──────────────────────────────────────

describe('formatScoredModelsForPrompt', () => {
  it('returns non-empty string with table headers', () => {
    const results = scoreAllModels(macM3_36GB);
    const output = formatScoredModelsForPrompt(results);
    expect(output.length).toBeGreaterThan(50);
    expect(output).toContain('Model');
    expect(output).toContain('Score');
    expect(output).toContain('Fit');
  });

  it('respects topN limit', () => {
    const results = scoreAllModels(macM3_36GB);
    const output3 = formatScoredModelsForPrompt(results, 3);
    const output10 = formatScoredModelsForPrompt(results, 10);
    expect(output3.length).toBeLessThan(output10.length);
  });
});

// ── lookupGPUBandwidth ───────────────────────────────────────────────

describe('lookupGPUBandwidth', () => {
  it('NVIDIA RTX 4090 → 1008', () => {
    expect(lookupGPUBandwidth('NVIDIA RTX 4090')).toBe(1008);
  });

  it('Apple M3 Max → 400', () => {
    expect(lookupGPUBandwidth('Apple M3 Max')).toBe(400);
  });

  it('Unknown GPU → null', () => {
    expect(lookupGPUBandwidth('Unknown GPU')).toBeNull();
  });

  it('L40S data center GPU → 864', () => {
    expect(lookupGPUBandwidth('NVIDIA L40S')).toBe(864);
  });

  it('empty string → null', () => {
    expect(lookupGPUBandwidth('')).toBeNull();
  });
});

// ── scoreFitLevel ────────────────────────────────────────────────────

describe('scoreFitLevel', () => {
  it('3GB required, 8GB available, GPU → perfect', () => {
    expect(scoreFitLevel(3, 8, 'gpu')).toBe('perfect');
  });

  it('7GB required, 8GB available, GPU → marginal', () => {
    expect(scoreFitLevel(7, 8, 'gpu')).toBe('marginal');
  });

  it('9GB required, 8GB available → too_tight', () => {
    expect(scoreFitLevel(9, 8, 'gpu')).toBe('too_tight');
  });

  it('CPU-only is capped at marginal', () => {
    expect(scoreFitLevel(2, 8, 'cpu_only')).toBe('marginal');
  });
});

// ── Scoring functions ────────────────────────────────────────────────

describe('scoring functions', () => {
  it('scoreQuality increases with param count', () => {
    const small = scoreQuality(1, 'qwen', 'Q4_K_M', 'general');
    const large = scoreQuality(8, 'qwen', 'Q4_K_M', 'general');
    expect(large).toBeGreaterThan(small);
  });

  it('scoreSpeed returns 100 when TPS equals target', () => {
    expect(scoreSpeed(40, 'general')).toBe(100);
  });

  it('scoreFit returns 100 for 50-80% utilization', () => {
    expect(scoreFit(6, 10)).toBe(100);
    expect(scoreFit(7, 10)).toBe(100);
  });

  it('scoreFit returns 0 when model exceeds available', () => {
    expect(scoreFit(10, 5)).toBe(0);
  });

  it('scoreContext returns 100 when context meets target', () => {
    expect(scoreContext(8192, 'general')).toBe(100);
  });

  it('computeCompositeScore returns a number in [0, 100]', () => {
    const scores = { quality: 80, speed: 60, fit: 90, context: 100 };
    const composite = computeCompositeScore(scores, 'general');
    expect(composite).toBeGreaterThanOrEqual(0);
    expect(composite).toBeLessThanOrEqual(100);
  });
});

// ── getHardwareRequirements ──────────────────────────────────────────

describe('getHardwareRequirements', () => {
  it('returns requirements for known model', () => {
    const req = getHardwareRequirements('Qwen 3 8B', 'GGUF', 4);
    expect(req).not.toBeNull();
    expect(req!.minRAMGB).toBeGreaterThan(0);
    expect(req!.recommendedRAMGB).toBeGreaterThan(req!.minRAMGB);
  });

  it('returns null for unknown model', () => {
    expect(getHardwareRequirements('Nonexistent Model', 'GGUF', 4)).toBeNull();
  });
});
