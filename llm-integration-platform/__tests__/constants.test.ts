import {
  SUPPORTED_MODELS,
  METHOD_BITS,
  getModelNameList,
  buildModelMap,
  findModelByName,
  findModelByRepoId,
  DEVICE_CLASS_LIMITS,
  QUANTIZATION_PRESETS,
  DEFAULT_THRESHOLDS,
} from '@/lib/constants';

describe('SUPPORTED_MODELS', () => {
  it('has at least 10 models', () => {
    expect(SUPPORTED_MODELS.length).toBeGreaterThanOrEqual(10);
  });

  it('all models have required fields', () => {
    for (const model of SUPPORTED_MODELS) {
      expect(model.name).toBeTruthy();
      expect(model.repoId).toBeTruthy();
      expect(model.methods.length).toBeGreaterThan(0);
      for (const method of model.methods) {
        expect(['GGUF', 'AWQ', 'GPTQ', 'BitNet', 'MLX', 'FP16']).toContain(method);
      }
    }
  });

  it('all models have valid repoId format', () => {
    for (const model of SUPPORTED_MODELS) {
      expect(model.repoId).toMatch(/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+$/);
    }
  });
});

describe('METHOD_BITS', () => {
  it('has all quantization methods', () => {
    expect(METHOD_BITS.GGUF).toBeDefined();
    expect(METHOD_BITS.AWQ).toBeDefined();
    expect(METHOD_BITS.GPTQ).toBeDefined();
    expect(METHOD_BITS.BITNET).toBeDefined();
  });

  it('GGUF has more precision options', () => {
    expect(METHOD_BITS.GGUF.length).toBeGreaterThanOrEqual(4);
  });

  it('AWQ includes 4-bit', () => {
    expect(METHOD_BITS.AWQ).toContain(4);
  });

  it('GPTQ supports multiple bit widths', () => {
    expect(METHOD_BITS.GPTQ).toContain(4);
    expect(METHOD_BITS.GPTQ).toContain(8);
  });

  it('BitNet is 1-bit only', () => {
    expect(METHOD_BITS.BITNET).toEqual([1]);
  });
});

describe('getModelNameList', () => {
  it('returns array of strings', () => {
    const names = getModelNameList();
    expect(Array.isArray(names)).toBe(true);
    expect(names.length).toBe(SUPPORTED_MODELS.length);
    for (const name of names) {
      expect(typeof name).toBe('string');
    }
  });
});

describe('buildModelMap', () => {
  it('returns name to repoId mapping', () => {
    const map = buildModelMap();
    expect(map['SmolLM2 1.7B']).toBe('HuggingFaceTB/SmolLM2-1.7B-Instruct');
    expect(map['SmolLM2 135M']).toBe('HuggingFaceTB/SmolLM2-135M-Instruct');
  });
});

describe('findModelByName', () => {
  it('finds existing model', () => {
    const model = findModelByName('SmolLM2 1.7B');
    expect(model).toBeDefined();
    expect(model?.repoId).toBe('HuggingFaceTB/SmolLM2-1.7B-Instruct');
  });

  it('returns undefined for non-existent model', () => {
    expect(findModelByName('NonExistent')).toBeUndefined();
  });
});

describe('findModelByRepoId', () => {
  it('finds existing model by repoId', () => {
    const model = findModelByRepoId('HuggingFaceTB/SmolLM2-1.7B-Instruct');
    expect(model).toBeDefined();
    expect(model?.name).toBe('SmolLM2 1.7B');
  });

  it('returns undefined for non-existent repoId', () => {
    expect(findModelByRepoId('fake/model')).toBeUndefined();
  });
});

describe('DEVICE_CLASS_LIMITS', () => {
  it('has all device classes', () => {
    expect(DEVICE_CLASS_LIMITS.edge).toBeDefined();
    expect(DEVICE_CLASS_LIMITS.mobile).toBeDefined();
    expect(DEVICE_CLASS_LIMITS.laptop).toBeDefined();
    expect(DEVICE_CLASS_LIMITS.cloud).toBeDefined();
  });

  it('cloud has highest limits', () => {
    expect(DEVICE_CLASS_LIMITS.cloud.maxMemory).toBeGreaterThan(DEVICE_CLASS_LIMITS.laptop.maxMemory);
    expect(DEVICE_CLASS_LIMITS.cloud.typicalTokensPerSec).toBeGreaterThan(
      DEVICE_CLASS_LIMITS.laptop.typicalTokensPerSec
    );
  });

  it('edge has lowest limits', () => {
    expect(DEVICE_CLASS_LIMITS.edge.maxMemory).toBeLessThanOrEqual(DEVICE_CLASS_LIMITS.mobile.maxMemory);
  });
});

describe('QUANTIZATION_PRESETS', () => {
  it('has at least 3 presets', () => {
    expect(QUANTIZATION_PRESETS.length).toBeGreaterThanOrEqual(3);
  });

  it('all presets have required fields', () => {
    for (const preset of QUANTIZATION_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.description).toBeTruthy();
      expect(preset.method).toBeTruthy();
      expect(preset.bitsPerWeight).toBeGreaterThan(0);
      expect(preset.groupSize).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_THRESHOLDS', () => {
  it('has CPU and memory thresholds', () => {
    expect(DEFAULT_THRESHOLDS.cpuUsage).toBeDefined();
    expect(DEFAULT_THRESHOLDS.memoryUsage).toBeDefined();
  });

  it('warning < critical for all thresholds', () => {
    expect(DEFAULT_THRESHOLDS.cpuUsage.warning).toBeLessThan(DEFAULT_THRESHOLDS.cpuUsage.critical);
    expect(DEFAULT_THRESHOLDS.memoryUsage.warning).toBeLessThan(DEFAULT_THRESHOLDS.memoryUsage.critical);
    expect(DEFAULT_THRESHOLDS.gpuTemp.warning).toBeLessThan(DEFAULT_THRESHOLDS.gpuTemp.critical);
    expect(DEFAULT_THRESHOLDS.latencyMs.warning).toBeLessThan(DEFAULT_THRESHOLDS.latencyMs.critical);
  });

  it('tokensPerSec warning > critical (inverse threshold)', () => {
    expect(DEFAULT_THRESHOLDS.tokensPerSec.warning).toBeGreaterThan(DEFAULT_THRESHOLDS.tokensPerSec.critical);
  });
});
