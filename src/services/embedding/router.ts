import type { EmbeddingProvider, EmbedRequest, EmbedResult, EmbedMetadata } from './types';
import { localEmbeddingProvider } from './providers/local';
import { cloudEmbeddingProvider } from './providers/cloud';

export interface RoutingPolicy {
  classification: Record<string, string>;
  modality: Record<string, string>;
  priority: Record<string, string>;
  fallback: string;
}

const defaultPolicy: RoutingPolicy = {
  classification: {
    internal: 'local',
    confidential: 'local',
    public: 'cloud',
  },
  modality: {
    text: 'auto',
    image: 'cloud',
    video: 'cloud',
  },
  priority: {
    high: 'local',
    normal: 'auto',
    low: 'cloud',
  },
  fallback: 'auto',
};

let registered: Record<string, EmbeddingProvider> = {
  [localEmbeddingProvider.id]: localEmbeddingProvider,
  [cloudEmbeddingProvider.id]: cloudEmbeddingProvider,
};

let activePolicy = { ...defaultPolicy };

export function registerProvider(provider: EmbeddingProvider): void {
  registered[provider.id] = provider;
}

export function unregisterProvider(id: string): void {
  delete registered[id];
}

export function getProviders(): Record<string, EmbeddingProvider> {
  return { ...registered };
}

export function setRoutingPolicy(policy: Partial<RoutingPolicy>): void {
  activePolicy = { ...activePolicy, ...policy };
}

export function resolveProvider(metadata?: EmbedMetadata): EmbeddingProvider {
  const target = decideTarget(metadata);
  const provider = resolveFromTarget(target);
  if (provider && isUsable(provider)) {
    return provider;
  }
  return fallbackProvider(metadata);
}

function decideTarget(metadata?: EmbedMetadata): string {
  if (!metadata) return activePolicy.fallback;

  const clsKey = metadata.classification;
  if (clsKey && activePolicy.classification[clsKey]) {
    const target = activePolicy.classification[clsKey];
    if (target !== 'auto') return target;
  }

  const modKey = metadata.modality;
  if (modKey && activePolicy.modality[modKey]) {
    const target = activePolicy.modality[modKey];
    if (target !== 'auto') return target;
  }

  const priKey = metadata.priority;
  if (priKey && activePolicy.priority[priKey]) {
    const target = activePolicy.priority[priKey];
    if (target !== 'auto') return target;
  }

  return activePolicy.fallback;
}

function resolveFromTarget(target: string): EmbeddingProvider | null {
  if (registered[target]) return registered[target];

  if (target === 'auto') {
    if (isUsable(registered['cloud'])) return registered['cloud'];
    return registered['local'];
  }

  return null;
}

function fallbackProvider(metadata?: EmbedMetadata): EmbeddingProvider {
  for (const provider of Object.values(registered)) {
    if (isUsable(provider)) {
      const modality = metadata?.modality ?? 'text';
      if (provider.supportedModalities().includes(modality)) {
        return provider;
      }
    }
  }
  return registered['local'];
}

function isUsable(provider: EmbeddingProvider | null): boolean {
  return !!(provider && provider.isAvailable());
}

export function route(request: EmbedRequest): Promise<EmbedResult> {
  const provider = resolveProvider(request.metadata);
  return provider.embed(request);
}
