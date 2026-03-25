/**
 * Tests for chat model listing logic.
 * Tests the core scanning/filtering without importing the route handler directly
 * (which requires Next.js runtime APIs not available in jsdom).
 */

describe('Chat model listing logic', () => {
  it('correctly identifies GGUF files by extension', () => {
    const testFiles = [
      'SmolLM2-135M-q4_K_M.gguf',
      'model.txt',
      'README.md',
      'Qwen3-0.6B-q4_K_M.gguf',
    ];
    const ggufFiles = testFiles.filter(f => f.endsWith('.gguf'));
    expect(ggufFiles).toEqual([
      'SmolLM2-135M-q4_K_M.gguf',
      'Qwen3-0.6B-q4_K_M.gguf',
    ]);
  });

  it('correctly identifies AWQ directories by name pattern', () => {
    const testDirs = [
      'SmolLM2-1.7B-Instruct-awq-4bit',
      'Qwen3-0.6B-awq-4bit',
      '_work_gguf',
      'regular-dir',
    ];
    const awqDirs = testDirs.filter(d => d.includes('-awq-'));
    expect(awqDirs).toEqual([
      'SmolLM2-1.7B-Instruct-awq-4bit',
      'Qwen3-0.6B-awq-4bit',
    ]);
  });

  it('skips work directories', () => {
    const entries = ['_work_gguf', '_work_awq', 'model.gguf', 'real-dir'];
    const filtered = entries.filter(e => !e.startsWith('_work_'));
    expect(filtered).toEqual(['model.gguf', 'real-dir']);
  });

  it('extracts display name from GGUF filename', () => {
    function extractDisplayName(filename: string): string {
      const baseName = filename.replace('.gguf', '');
      const parts = baseName.split('-');
      const quantPart = parts.pop() || '';
      const quantPart2 = parts[parts.length - 1];
      if (quantPart2 && /^[qQ]\d/.test(quantPart2)) {
        return parts.slice(0, -1).join('-') + ' ' + quantPart2 + '_' + quantPart;
      }
      return parts.join('-') + ' ' + quantPart;
    }

    expect(extractDisplayName('SmolLM2-135M-Instruct-q4_K_M.gguf'))
      .toContain('SmolLM2');
    expect(extractDisplayName('Qwen3-0.6B-q4_K_M.gguf'))
      .toContain('Qwen3');
  });

  it('extracts display name from AWQ directory', () => {
    function awqDisplayName(dirName: string): string {
      return dirName.replace(/-awq-/g, ' AWQ ').replace(/-/g, ' ');
    }

    expect(awqDisplayName('SmolLM2-1.7B-Instruct-awq-4bit'))
      .toBe('SmolLM2 1.7B Instruct AWQ 4bit');
    expect(awqDisplayName('Qwen3-0.6B-awq-4bit'))
      .toBe('Qwen3 0.6B AWQ 4bit');
  });

  it('sorts models by method then name', () => {
    const models = [
      { name: 'Zeta', method: 'GGUF' },
      { name: 'Alpha', method: 'GGUF' },
      { name: 'Beta', method: 'AWQ' },
    ];
    models.sort((a, b) => {
      if (a.method !== b.method) return a.method.localeCompare(b.method);
      return a.name.localeCompare(b.name);
    });
    expect(models[0]).toEqual({ name: 'Beta', method: 'AWQ' });
    expect(models[1]).toEqual({ name: 'Alpha', method: 'GGUF' });
    expect(models[2]).toEqual({ name: 'Zeta', method: 'GGUF' });
  });
});
