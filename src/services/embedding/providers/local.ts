import type { EmbeddingProvider, EmbedRequest, EmbedResult } from '../types';

const DIMENSION = 64;

function simpleHash(input: string): number[] {
  const vec = new Array<number>(DIMENSION);
  for (let i = 0; i < DIMENSION; i++) {
    let hash = 0;
    for (let j = 0; j < input.length; j++) {
      hash = ((hash << 5) - hash + input.charCodeAt(j) * (i + 1)) | 0;
    }
    vec[i] = (hash % 100) / 100;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? vec.map((v) => v / norm) : vec;
}

export const localEmbeddingProvider: EmbeddingProvider = {
  id: 'local',

  isAvailable: () => true,

  supportedModalities: () => ['text'],

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const embeddings = request.inputs.map((input) => {
      const text = typeof input === 'string' ? input : String(input);
      return simpleHash(text);
    });

    return {
      embeddings,
      provider: 'local',
      cached: false,
    };
  },
};
