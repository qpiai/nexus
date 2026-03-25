import {
  sanitizeName,
  validatePathUnderBase,
  clampNumeric,
  sanitizeErrorMessage,
} from '@/lib/vision-validation';

describe('sanitizeName', () => {
  it('strips path traversal sequences', () => {
    expect(sanitizeName('../../../etc/passwd')).toBe('etcpasswd');
    expect(sanitizeName('..dataset')).toBe('dataset');
    expect(sanitizeName('foo/../bar')).toBe('foobar');
  });

  it('strips slashes', () => {
    expect(sanitizeName('foo/bar')).toBe('foobar');
    expect(sanitizeName('foo\\bar')).toBe('foobar');
  });

  it('preserves valid names', () => {
    expect(sanitizeName('my_dataset-v2.1')).toBe('my_dataset-v2.1');
    expect(sanitizeName('COCO2024')).toBe('COCO2024');
  });

  it('truncates to 128 chars', () => {
    const long = 'a'.repeat(200);
    expect(sanitizeName(long)!.length).toBe(128);
  });

  it('returns null for empty result', () => {
    expect(sanitizeName('../..')).toBeNull();
    expect(sanitizeName('//\\\\..')).toBeNull();
  });

  it('replaces non-alphanumeric with underscore', () => {
    expect(sanitizeName('hello world!')).toBe('hello_world_');
    expect(sanitizeName('data@set#1')).toBe('data_set_1');
  });
});

describe('validatePathUnderBase', () => {
  it('accepts valid paths under base', () => {
    expect(validatePathUnderBase('/workspace/output/vision/model1', '/workspace/output')).toBe('/workspace/output/vision/model1');
  });

  it('accepts exact base path', () => {
    expect(validatePathUnderBase('/workspace/output', '/workspace/output')).toBe('/workspace/output');
  });

  it('rejects path traversal', () => {
    expect(() => validatePathUnderBase('/workspace/output/../secret', '/workspace/output')).toThrow('Path traversal denied');
  });

  it('rejects paths outside base', () => {
    expect(() => validatePathUnderBase('/etc/passwd', '/workspace/output')).toThrow('Path traversal denied');
  });

  it('rejects prefix tricks', () => {
    // /workspace/output-evil should not pass for base /workspace/output
    expect(() => validatePathUnderBase('/workspace/output-evil/foo', '/workspace/output')).toThrow('Path traversal denied');
  });
});

describe('clampNumeric', () => {
  it('clamps below min', () => {
    expect(clampNumeric(-5, 1, 100, 50)).toBe(1);
    expect(clampNumeric(0, 1, 100, 50)).toBe(1);
  });

  it('clamps above max', () => {
    expect(clampNumeric(200, 1, 100, 50)).toBe(100);
  });

  it('passes in-range values', () => {
    expect(clampNumeric(42, 1, 100, 50)).toBe(42);
    expect(clampNumeric(1, 1, 100, 50)).toBe(1);
    expect(clampNumeric(100, 1, 100, 50)).toBe(100);
  });

  it('returns fallback for NaN', () => {
    expect(clampNumeric(NaN, 1, 100, 50)).toBe(50);
    expect(clampNumeric('not-a-number', 1, 100, 50)).toBe(50);
    expect(clampNumeric(undefined, 1, 100, 50)).toBe(50);
  });

  it('returns fallback for Infinity', () => {
    expect(clampNumeric(Infinity, 1, 100, 50)).toBe(50);
    expect(clampNumeric(-Infinity, 1, 100, 50)).toBe(50);
  });

  it('handles string numbers', () => {
    expect(clampNumeric('42', 1, 100, 50)).toBe(42);
  });
});

describe('sanitizeErrorMessage', () => {
  it('strips ANSI escape codes', () => {
    expect(sanitizeErrorMessage('\x1b[31mError\x1b[0m')).toBe('Error');
    expect(sanitizeErrorMessage('\x1b[1;33mWarning\x1b[0m')).toBe('Warning');
  });

  it('strips project root paths', () => {
    const msg = 'File not found at /workspace/llm-integration-platform/output/model.pt';
    const result = sanitizeErrorMessage(msg, '/workspace/llm-integration-platform');
    expect(result).not.toContain('/workspace/llm-integration-platform');
    expect(result).toContain('[project]');
  });

  it('strips absolute paths', () => {
    const msg = 'Error in /home/user/secret/file.py at line 42';
    const result = sanitizeErrorMessage(msg);
    expect(result).not.toContain('/home/user/secret/file.py');
    expect(result).toContain('[path]');
  });

  it('truncates to 500 chars', () => {
    const long = 'x'.repeat(1000);
    expect(sanitizeErrorMessage(long).length).toBe(500);
  });

  it('handles empty string', () => {
    expect(sanitizeErrorMessage('')).toBe('');
  });
});
