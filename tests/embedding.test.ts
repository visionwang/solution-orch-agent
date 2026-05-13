import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('Embedding service (三层解耦)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.OPENAI_EMBEDDING_API_KEY;
    delete process.env.OPENAI_COMPAT_API_KEY;
  });

  it('isEmbeddingAvailable returns true always (local provider)', async () => {
    const { isEmbeddingAvailable } = await import('../src/services/embedding/index');
    expect(isEmbeddingAvailable()).toBe(true);
  });

  it('getEmbedding works via local provider without API key', async () => {
    const { getEmbedding } = await import('../src/services/embedding/index');
    const result = await getEmbedding('test text');
    expect(result).toBeInstanceOf(Array);
    expect(result).toHaveLength(64);
  });

  it('getEmbeddings works via local provider without API key', async () => {
    const { getEmbeddings } = await import('../src/services/embedding/index');
    const results = await getEmbeddings(['text a', 'text b']);
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveLength(64);
  });

  it('getEmbedding routes to cloud when API key is set', async () => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ embedding: [0.1, 0.2, 0.3], index: 0 }],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getEmbedding } = await import('../src/services/embedding/index');
    const result = await getEmbedding('hello', { classification: 'public' });

    expect(mockFetch).toHaveBeenCalled();
    expect(result).toEqual([0.1, 0.2, 0.3]);
  });

  it('getEmbeddings routes to cloud when API key is set', async () => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test';
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [
          { embedding: [1, 0], index: 0 },
          { embedding: [0, 1], index: 1 },
        ],
      }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getEmbeddings } = await import('../src/services/embedding/index');
    const results = await getEmbeddings(['text a', 'text b'], { classification: 'public' });

    expect(mockFetch).toHaveBeenCalled();
    expect(results).toHaveLength(2);
  });

  it('getEmbedding returns consistent results from cache', async () => {
    const { getEmbedding, clearCache } = await import('../src/services/embedding/index');
    clearCache();

    const r1 = await getEmbedding('cached text');
    const r2 = await getEmbedding('cached text');

    expect(r1).toEqual(r2);
  });
});
