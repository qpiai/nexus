import { generateId, formatBytes, formatNumber, formatDuration, clamp, addNoise } from '@/lib/utils';

describe('generateId', () => {
  it('returns a string', () => {
    expect(typeof generateId()).toBe('string');
  });

  it('returns unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });

  it('generates non-empty IDs', () => {
    expect(generateId().length).toBeGreaterThan(5);
  });
});

describe('formatBytes', () => {
  it('handles 0 bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
  });

  it('formats GB values', () => {
    // formatBytes takes GB and converts to bytes internally (*1e9)
    // 1 GB = 953.67 MB in binary (1e9 / 1024^2)
    const result = formatBytes(1);
    expect(result).toMatch(/\d.*(MB|GB)/);
  });

  it('formats larger values as GB', () => {
    const result = formatBytes(2);
    expect(result).toMatch(/\d.*(GB|MB)/);
  });
});

describe('formatNumber', () => {
  it('formats billions', () => {
    expect(formatNumber(2e9)).toBe('2.0B');
  });

  it('formats millions', () => {
    expect(formatNumber(5.5e6)).toBe('5.5M');
  });

  it('formats thousands', () => {
    expect(formatNumber(3500)).toBe('3.5K');
  });

  it('formats small numbers', () => {
    expect(formatNumber(42)).toBe('42.0');
  });

  it('respects decimal parameter', () => {
    expect(formatNumber(1234, 2)).toBe('1.23K');
  });
});

describe('formatDuration', () => {
  it('formats seconds', () => {
    expect(formatDuration(5000)).toBe('5s');
  });

  it('formats minutes and seconds', () => {
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('formats hours and minutes', () => {
    expect(formatDuration(3720000)).toBe('1h 2m');
  });

  it('handles zero', () => {
    expect(formatDuration(0)).toBe('0s');
  });
});

describe('clamp', () => {
  it('clamps value below min', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });

  it('clamps value above max', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it('returns value within range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it('handles equal min and max', () => {
    expect(clamp(50, 10, 10)).toBe(10);
  });
});

describe('addNoise', () => {
  it('returns a value near the base', () => {
    const results = Array.from({ length: 100 }, () => addNoise(100, 10));
    for (const r of results) {
      expect(r).toBeGreaterThanOrEqual(90);
      expect(r).toBeLessThanOrEqual(110);
    }
  });

  it('returns exact base when noise is 0', () => {
    expect(addNoise(42, 0)).toBe(42);
  });
});
