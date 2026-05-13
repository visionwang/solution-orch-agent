import { describe, expect, it, beforeEach } from 'vitest';

describe('Embedding cache (缓存加速层)', () => {
  beforeEach(async () => {
    const { clearCache } = await import('../src/services/embedding/index');
    clearCache();
  });

  it('second call hits cache', async () => {
    const { getEmbedding, getCacheStats } = await import('../src/services/embedding/index');

    await getEmbedding('cache test');
    const statsBefore = getCacheStats();
    expect(statsBefore.missCount).toBe(1);

    await getEmbedding('cache test');
    const statsAfter = getCacheStats();
    expect(statsAfter.hitCount).toBe(1);
  });

  it('different input misses cache', async () => {
    const { getEmbedding, getCacheStats } = await import('../src/services/embedding/index');

    await getEmbedding('text A');
    await getEmbedding('text B');

    const stats = getCacheStats();
    expect(stats.missCount).toBe(2);
  });

  it('clearCache resets all stats', async () => {
    const { getEmbedding, getCacheStats, clearCache } = await import('../src/services/embedding/index');

    await getEmbedding('text 1');
    await getEmbedding('text 2');
    clearCache();

    const stats = getCacheStats();
    expect(stats.size).toBe(0);
    expect(stats.hitCount).toBe(0);
    expect(stats.missCount).toBe(0);
  });

  it('cache size is bounded', async () => {
    const { getEmbedding, getCacheStats } = await import('../src/services/embedding/index');

    // Send 100 unique requests (should stay within maxSize=1000)
    for (let i = 0; i < 100; i++) {
      await getEmbedding(`unique text ${i}`);
    }

    const stats = getCacheStats();
    expect(stats.size).toBeLessThanOrEqual(100);
  });
});
