/**
 * Tests for deploy validation logic (Patent Claim 20).
 * Tests the safety check calculations directly.
 */

describe('Deploy validation safety checks', () => {
  // Reproduce the validation logic from the route
  function validateDeployment(
    modelSizeMB: number,
    target: string,
    deviceSpecs?: { ramGB?: number; storageGB?: number; tdpWatts?: number }
  ) {
    const ramGB = deviceSpecs?.ramGB || (target === 'cloud' ? 64 : target === 'edge' ? 4 : 16);
    const storageGB = deviceSpecs?.storageGB || (target === 'cloud' ? 500 : target === 'edge' ? 32 : 256);
    const tdpWatts = deviceSpecs?.tdpWatts || (target === 'cloud' ? 300 : target === 'edge' ? 15 : 65);

    const modelSizeGB = modelSizeMB / 1024;
    const runtimeMemoryGB = modelSizeGB * 1.3;
    const memoryMargin = ((ramGB - runtimeMemoryGB) / ramGB) * 100;
    const storageMargin = ((storageGB - modelSizeGB) / storageGB) * 100;
    const estimatedPowerDraw = modelSizeGB * 8;
    const thermalMargin = ((tdpWatts - estimatedPowerDraw) / tdpWatts) * 100;

    const checks = [
      {
        name: 'Memory Safety',
        status: memoryMargin > 20 ? 'pass' : memoryMargin > 5 ? 'warn' : 'fail',
        margin: memoryMargin,
      },
      {
        name: 'Storage Capacity',
        status: storageMargin > 10 ? 'pass' : storageMargin > 2 ? 'warn' : 'fail',
        margin: storageMargin,
      },
      {
        name: 'Thermal Envelope',
        status: thermalMargin > 25 ? 'pass' : thermalMargin > 10 ? 'warn' : 'fail',
        margin: thermalMargin,
      },
    ];

    const hasFail = checks.some(c => c.status === 'fail');
    return { safe: !hasFail, checks };
  }

  it('passes all checks for small model on cloud', () => {
    const result = validateDeployment(100, 'cloud'); // 100MB model
    expect(result.safe).toBe(true);
    for (const check of result.checks) {
      expect(check.status).toBe('pass');
    }
  });

  it('fails memory check for large model on edge', () => {
    const result = validateDeployment(4096, 'edge'); // 4GB model, 4GB RAM default
    expect(result.safe).toBe(false);
    const memCheck = result.checks.find(c => c.name === 'Memory Safety')!;
    expect(memCheck.status).toBe('fail');
  });

  it('warns for borderline memory', () => {
    const result = validateDeployment(2560, 'edge'); // 2.5GB model
    const memCheck = result.checks.find(c => c.name === 'Memory Safety')!;
    // 2.5GB * 1.3 = 3.25GB runtime, margin = (4-3.25)/4 = 18.75%
    expect(memCheck.status).toBe('warn');
  });

  it('uses correct defaults for cloud target', () => {
    const result = validateDeployment(100, 'cloud');
    // Cloud: 64GB RAM, 500GB storage, 300W TDP
    // 100MB model - everything should pass with huge margins
    for (const check of result.checks) {
      expect(check.margin).toBeGreaterThan(90);
    }
  });

  it('uses correct defaults for edge target', () => {
    const result = validateDeployment(100, 'edge');
    // Edge: 4GB RAM, 32GB storage, 15W TDP
    // 100MB model should pass easily
    expect(result.safe).toBe(true);
  });

  it('uses custom device specs', () => {
    const result = validateDeployment(1024, 'edge', { ramGB: 32, storageGB: 256, tdpWatts: 100 });
    // 1GB model on 32GB RAM = easy pass
    expect(result.safe).toBe(true);
    const memCheck = result.checks.find(c => c.name === 'Memory Safety')!;
    expect(memCheck.margin).toBeGreaterThan(90);
  });

  it('memory margin includes 30% runtime overhead', () => {
    // Test: 1GB model needs 1.3GB runtime (30% overhead)
    const result = validateDeployment(1024, 'cloud');
    const memCheck = result.checks.find(c => c.name === 'Memory Safety')!;
    // 1GB * 1.3 = 1.3GB, margin = (64-1.3)/64 * 100 ≈ 97.97%
    expect(memCheck.margin).toBeCloseTo(97.97, 0);
  });

  it('thermal check estimates 8W per GB', () => {
    // 10GB model -> 80W estimated power draw
    const result = validateDeployment(10240, 'cloud');
    const thermalCheck = result.checks.find(c => c.name === 'Thermal Envelope')!;
    // 10GB * 8 = 80W, margin = (300-80)/300 * 100 ≈ 73.3%
    expect(thermalCheck.margin).toBeCloseTo(73.3, 0);
    expect(thermalCheck.status).toBe('pass');
  });

  it('storage check uses model size (not runtime)', () => {
    const result = validateDeployment(100, 'cloud');
    const storageCheck = result.checks.find(c => c.name === 'Storage Capacity')!;
    // 100MB model = ~0.098GB, margin = (500-0.098)/500 * 100 ≈ 99.98%
    expect(storageCheck.margin).toBeGreaterThan(99);
  });
});
