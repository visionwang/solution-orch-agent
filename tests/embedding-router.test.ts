import { describe, expect, it, beforeEach } from 'vitest';

describe('Embedding router (策略控制层)', () => {
  beforeEach(async () => {
    const { clearCache } = await import('../src/services/embedding/index');
    clearCache();
  });

  it('routes internal data to local provider', async () => {
    const { getEmbedding } = await import('../src/services/embedding/index');
    const { getStats } = await import('../src/services/embedding/cache');

    const result = await getEmbedding('sensitive internal data', {
      classification: 'internal',
    });
    expect(result).toHaveLength(64);

    // Verify cache records the provider hit
    const stats = getStats();
    expect(stats.missCount).toBe(1);
  });

  it('routes confidential data to local provider', async () => {
    const { getEmbedding } = await import('../src/services/embedding/index');
    const result = await getEmbedding('confidential doc', {
      classification: 'confidential',
    });
    expect(result).toHaveLength(64);
  });

  it('routes high priority to local provider', async () => {
    const { getEmbedding } = await import('../src/services/embedding/index');
    const result = await getEmbedding('urgent request', {
      priority: 'high',
    });
    expect(result).toHaveLength(64);
  });

  it('routes image modality to cloud (when available)', async () => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test';
    const { setRoutingPolicy, resolveProvider } = await import('../src/services/embedding/router');

    const provider = resolveProvider({ modality: 'image' });
    // With API key available, image routes to cloud
    expect(provider.id).toBe('cloud');
    delete process.env.OPENAI_COMPAT_API_KEY;
  });

  it('custom routing policy can override defaults', async () => {
    const { setRoutingPolicy, resolveProvider } = await import('../src/services/embedding/router');

    // Override: public data goes to local
    setRoutingPolicy({
      classification: { public: 'local' },
    });

    const provider = resolveProvider({ classification: 'public' });
    expect(provider.id).toBe('local');
  });
});
