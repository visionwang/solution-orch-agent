import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('LLM client module', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    delete process.env.OPENAI_COMPAT_API_KEY;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('isLlmAvailable returns false when no API key', async () => {
    const { isLlmAvailable } = await import('../src/services/llm');
    expect(isLlmAvailable()).toBe(false);
  });

  it('isLlmAvailable returns true when API key is set', async () => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test-key';
    const { isLlmAvailable } = await import('../src/services/llm');
    expect(isLlmAvailable()).toBe(true);
  });

  it('callLlm throws when no API key configured', async () => {
    const { callLlm } = await import('../src/services/llm');
    await expect(callLlm('test prompt')).rejects.toThrow('LLM API key not configured');
  });

  it('callLlm sends correct request to OpenAI compatible API', async () => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test-key';
    process.env.OPENAI_COMPAT_BASE_URL = 'https://test-api.example.com/v1';
    process.env.OPENAI_COMPAT_MODEL = 'test-model';

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'Hello, world!' } }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callLlm } = await import('../src/services/llm');
    const result = await callLlm('Say hello');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test-api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer sk-test-key',
        }),
        body: expect.stringContaining('Say hello'),
      })
    );
    expect(result).toBe('Hello, world!');

  });

  it('callLlm throws on non-ok response', async () => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test-key';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('unauthorized'),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callLlm } = await import('../src/services/llm');
    await expect(callLlm('test')).rejects.toThrow('LLM API error (401)');

  });

  it('callLlmJson extracts JSON from code block', async () => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test-key';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '```json\n{"key": "value"}\n```' } }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callLlmJson } = await import('../src/services/llm');
    const result = await callLlmJson<{ key: string }>('Return JSON');

    expect(result).toEqual({ key: 'value' });

  });

  it('callLlmJson parses raw JSON without code block', async () => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test-key';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: '{"items": [1, 2, 3]}' } }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callLlmJson } = await import('../src/services/llm');
    const result = await callLlmJson<{ items: number[] }>('test');

    expect(result).toEqual({ items: [1, 2, 3] });

  });

  it('callLlm uses default config when env vars not set', async () => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test-key';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: 'ok' } }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { callLlm } = await import('../src/services/llm');
    await callLlm('test');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.deepseek.com/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"model":"deepseek-chat"'),
      })
    );

  });
});
