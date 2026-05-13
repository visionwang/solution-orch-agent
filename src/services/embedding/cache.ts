import type { EmbedRequest, EmbedResult } from './types';

interface CacheEntry {
  result: EmbedResult;
  createdAt: number;
  lastAccessed: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hitCount: number;
  missCount: number;
}

const MAX_SIZE = 1000;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

const store = new Map<string, CacheEntry>();
let hitCount = 0;
let missCount = 0;
let ttlMs = DEFAULT_TTL_MS;

function buildKey(request: EmbedRequest): string {
  const parts = request.inputs.map((s) => String(s).slice(0, 256));
  return parts.join('|');
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now - entry.createdAt > ttlMs) {
      store.delete(key);
    }
  }
}

function evictLru(): void {
  let oldestKey = '';
  let oldestTime = Infinity;
  for (const [key, entry] of store) {
    if (entry.lastAccessed < oldestTime) {
      oldestTime = entry.lastAccessed;
      oldestKey = key;
    }
  }
  if (oldestKey) store.delete(oldestKey);
}

export function get(request: EmbedRequest): EmbedResult | undefined {
  purgeExpired();
  const key = buildKey(request);
  const entry = store.get(key);
  if (entry) {
    entry.lastAccessed = Date.now();
    hitCount++;
    return { ...entry.result, cached: true };
  }
  missCount++;
  return undefined;
}

export function set(request: EmbedRequest, result: EmbedResult): void {
  const key = buildKey(request);
  if (store.has(key)) {
    const existing = store.get(key)!;
    existing.result = result;
    existing.lastAccessed = Date.now();
    return;
  }
  if (store.size >= MAX_SIZE) {
    evictLru();
  }
  const now = Date.now();
  store.set(key, { result, createdAt: now, lastAccessed: now });
}

export function clear(): void {
  store.clear();
  hitCount = 0;
  missCount = 0;
}

export function getStats(): CacheStats {
  return {
    size: store.size,
    maxSize: MAX_SIZE,
    hitCount,
    missCount,
  };
}
