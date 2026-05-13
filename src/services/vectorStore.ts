import { randomUUID } from 'node:crypto';
import type { AppDatabase, StoredVectorChunk } from '../storage/database';
import type { KnowledgeChunk } from '../shared/types';
import { getEmbedding, getEmbeddings, isEmbeddingAvailable } from './embedding/index';

export interface SearchResult {
  chunk: StoredVectorChunk;
  similarity: number;
}

export function createVectorStore(db: AppDatabase) {
  return {
    async indexChunks(chunks: KnowledgeChunk[]): Promise<void> {
      if (!isEmbeddingAvailable() || chunks.length === 0) return;

      db.clearVectorChunks();

      const texts = chunks.map((c) => c.content);
      const embeddings = await getEmbeddings(texts);

      const now = new Date().toISOString();
      for (let i = 0; i < chunks.length; i++) {
        db.saveVectorChunk({
          id: randomUUID(),
          documentId: chunks[i].documentId,
          content: chunks[i].content,
          embedding: embeddings[i],
          createdAt: now,
        });
      }
    },

    async searchSimilar(query: string, topK: number): Promise<SearchResult[]> {
      if (!isEmbeddingAvailable()) return [];

      try {
        const queryEmbedding = await getEmbedding(query);
        const chunks = db.getVectorChunks();

        const results = chunks
          .map((chunk) => ({
            chunk,
            similarity: cosineSimilarity(queryEmbedding, chunk.embedding),
          }))
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, topK);

        return results;
      } catch {
        return [];
      }
    },

    isAvailable(): boolean {
      return isEmbeddingAvailable();
    },
  };
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
