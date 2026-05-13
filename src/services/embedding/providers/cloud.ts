import type { EmbeddingProvider, EmbedRequest, EmbedResult } from '../types';

function loadConfig(request?: EmbedRequest) {
  return {
    baseUrl: (process.env.OPENAI_COMPAT_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.OPENAI_EMBEDDING_API_KEY ?? process.env.OPENAI_COMPAT_API_KEY ?? '',
    model: request?.metadata?.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small',
  };
}

export const cloudEmbeddingProvider: EmbeddingProvider = {
  id: 'cloud',

  isAvailable: () => {
    const { apiKey } = loadConfig();
    return !!apiKey;
  },

  supportedModalities: () => ['text'],

  async embed(request: EmbedRequest): Promise<EmbedResult> {
    const { baseUrl, apiKey, model } = loadConfig(request);

    if (!apiKey) {
      throw new Error('Cloud embedding API key not configured.');
    }

    const inputs = request.inputs.map((t) => String(t).slice(0, 8192));

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: inputs }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error');
      throw new Error(`Cloud embedding API error (${response.status}): ${errorBody}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    const embeddings = data.data
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);

    if (embeddings.length === 0) {
      throw new Error('Cloud embedding API returned empty result');
    }

    return {
      embeddings,
      provider: 'cloud',
      cached: false,
    };
  },
};
