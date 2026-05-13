export interface EmbedMetadata {
  classification?: 'internal' | 'confidential' | 'public';
  priority?: 'low' | 'normal' | 'high';
  modality?: 'text' | 'image' | 'video';
  model?: string;
  [key: string]: unknown;
}

export interface EmbedRequest {
  inputs: string[];
  metadata?: EmbedMetadata;
}

export interface EmbedResult {
  embeddings: number[][];
  provider: string;
  cached: boolean;
}

export interface EmbeddingProvider {
  id: string;
  embed(request: EmbedRequest): Promise<EmbedResult>;
  isAvailable(): boolean;
  supportedModalities(): string[];
}
