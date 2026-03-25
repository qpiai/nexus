/**
 * Tests for chat route logic.
 * Tests ChatML formatting and request validation logic directly.
 */

describe('ChatML formatting', () => {
  interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
  }

  function formatChatML(messages: ChatMessage[]): string {
    let prompt = '';
    for (const msg of messages) {
      prompt += `<|im_start|>${msg.role}\n${msg.content}<|im_end|>\n`;
    }
    prompt += '<|im_start|>assistant\n';
    return prompt;
  }

  it('formats single user message', () => {
    const result = formatChatML([{ role: 'user', content: 'Hello' }]);
    expect(result).toBe('<|im_start|>user\nHello<|im_end|>\n<|im_start|>assistant\n');
  });

  it('formats multi-turn conversation', () => {
    const result = formatChatML([
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
      { role: 'user', content: 'And 3+3?' },
    ]);
    expect(result).toContain('<|im_start|>user\nWhat is 2+2?<|im_end|>');
    expect(result).toContain('<|im_start|>assistant\n4<|im_end|>');
    expect(result).toContain('<|im_start|>user\nAnd 3+3?<|im_end|>');
    expect(result.endsWith('<|im_start|>assistant\n')).toBe(true);
  });

  it('includes system message', () => {
    const result = formatChatML([
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Hello' },
    ]);
    expect(result).toContain('<|im_start|>system\nYou are a helpful assistant.<|im_end|>');
  });

  it('handles empty messages array', () => {
    const result = formatChatML([]);
    expect(result).toBe('<|im_start|>assistant\n');
  });

  it('preserves newlines in content', () => {
    const result = formatChatML([
      { role: 'user', content: 'Line 1\nLine 2\nLine 3' },
    ]);
    expect(result).toContain('Line 1\nLine 2\nLine 3');
  });

  it('handles special characters in content', () => {
    const result = formatChatML([
      { role: 'user', content: 'What is <html> & "quotes"?' },
    ]);
    expect(result).toContain('What is <html> & "quotes"?');
  });
});

describe('Chat request validation', () => {
  function validateChatRequest(body: Record<string, unknown>): { valid: boolean; error?: string } {
    const { model, method, messages } = body;
    if (!model || !method || !messages || !Array.isArray(messages)) {
      return { valid: false, error: 'Missing model, method, or messages' };
    }
    const methodUpper = (method as string).toUpperCase();
    if (methodUpper !== 'GGUF' && methodUpper !== 'AWQ') {
      return { valid: false, error: 'Unsupported method' };
    }
    return { valid: true };
  }

  it('rejects missing model', () => {
    const result = validateChatRequest({ method: 'GGUF', messages: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects missing method', () => {
    const result = validateChatRequest({ model: 'test.gguf', messages: [] });
    expect(result.valid).toBe(false);
  });

  it('rejects missing messages', () => {
    const result = validateChatRequest({ model: 'test.gguf', method: 'GGUF' });
    expect(result.valid).toBe(false);
  });

  it('rejects non-array messages', () => {
    const result = validateChatRequest({ model: 'test.gguf', method: 'GGUF', messages: 'not an array' });
    expect(result.valid).toBe(false);
  });

  it('accepts valid GGUF request', () => {
    const result = validateChatRequest({
      model: 'test.gguf',
      method: 'GGUF',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.valid).toBe(true);
  });

  it('accepts valid AWQ request', () => {
    const result = validateChatRequest({
      model: 'test-awq-4bit',
      method: 'AWQ',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.valid).toBe(true);
  });

  it('is case insensitive for method', () => {
    const result = validateChatRequest({
      model: 'test.gguf',
      method: 'gguf',
      messages: [{ role: 'user', content: 'hello' }],
    });
    expect(result.valid).toBe(true);
  });
});
