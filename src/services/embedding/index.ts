import type { EmbedRequest, EmbedMetadata } from './types';
import { route } from './router';
import { get as cacheGet, set as cacheSet, clear as cacheClear, getStats as cacheGetStats } from './cache';

export { clearCache, getCacheStats };

function clearCache(): void {
  cacheClear();
}

function getCacheStats() {
  return cacheGetStats();
}

export function isEmbeddingAvailable(): boolean {
  return true; // local provider always available
}

export async function getEmbedding(input: string, metadata?: EmbedMetadata): Promise<number[]> {
  const result = await getEmbeddings([input], metadata);
  return result[0] ?? [];
}

export async function getEmbeddings(inputs: string[], metadata?: EmbedMetadata): Promise<number[][]> {
  const request: EmbedRequest = { inputs, metadata };

  // Cache layer
  const cached = cacheGet(request);
  if (cached) return cached.embeddings;

  // Route to provider
  const result = await route(request);

  // Store in cache
  cacheSet(request, result);

  return result.embeddings;
}
