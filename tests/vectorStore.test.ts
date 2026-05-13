import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/storage/database';

describe('Vector chunks in AppDatabase', () => {
  it('stores and retrieves vector chunks', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-vector-'));
    const db = createDatabase(dataDir);

    db.saveVectorChunk({
      id: 'vc-1',
      documentId: 'doc-1',
      content: '平台提供统一登录能力',
      embedding: [0.1, 0.5, 0.3],
      createdAt: new Date().toISOString(),
    });

    const chunks = db.getVectorChunks();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe('平台提供统一登录能力');
    expect(chunks[0].embedding).toEqual([0.1, 0.5, 0.3]);
  });

  it('clears all vector chunks', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-vector-'));
    const db = createDatabase(dataDir);

    db.saveVectorChunk({
      id: 'vc-1',
      documentId: 'doc-1',
      content: 'test',
      embedding: [0.1],
      createdAt: new Date().toISOString(),
    });
    db.saveVectorChunk({
      id: 'vc-2',
      documentId: 'doc-2',
      content: 'test 2',
      embedding: [0.2],
      createdAt: new Date().toISOString(),
    });

    expect(db.getVectorChunks()).toHaveLength(2);

    db.clearVectorChunks();
    expect(db.getVectorChunks()).toHaveLength(0);
  });
});
