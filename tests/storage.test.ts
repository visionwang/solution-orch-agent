import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/storage/database';
import { runBidWorkflow } from '../src/mastra/bidWorkflow';

describe('AppDatabase', () => {
  it('stores project documents and workflow results', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-'));
    const db = createDatabase(dataDir);
    const project = db.createProject('测试项目');
    db.saveDocument({
      projectId: project.id,
      kind: 'requirement',
      fileName: '需求.txt',
      mimeType: 'text/plain',
      storagePath: 'safe-upload-name.txt',
      text: '系统必须支持统一登录。',
      metadata: {}
    });
    db.saveDocument({
      projectId: project.id,
      kind: 'product',
      fileName: '产品.txt',
      mimeType: 'text/plain',
      storagePath: 'safe-product-name.txt',
      text: '产品提供统一登录能力。',
      metadata: {}
    });

    const result = await runBidWorkflow({
      projectId: project.id,
      documents: db.listDocuments(project.id)
    });
    db.saveWorkflowResult(result);

    expect(db.getRequirements(project.id)).toHaveLength(1);
    expect(db.getMatches(project.id)[0].status).toBe('matched');
    expect(db.getDrafts(project.id)).toHaveLength(2);
    expect(db.getReviewFindings(project.id).length).toBeGreaterThan(0);
    expect(db.getProject(project.id)?.status).toBe('completed');
  });
});

