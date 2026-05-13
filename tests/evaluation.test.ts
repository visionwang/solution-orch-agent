import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDatabase } from '../src/storage/database';

describe('Evaluation in AppDatabase', () => {
  it('stores and retrieves evaluation records', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-eval-'));
    const db = createDatabase(dataDir);

    const now = new Date().toISOString();
    db.saveEvaluation({
      id: 'eval-1',
      projectId: 'proj-1',
      runId: 'run-1',
      category: 'requirements',
      mode: 'llm',
      inputSnapshot: { docs: ['需求.txt'] },
      outputSnapshot: [{ title: '统一登录' }],
      score: null,
      notes: '',
      createdAt: now,
    });

    const evals = db.getEvaluations('proj-1');
    expect(evals).toHaveLength(1);
    expect(evals[0].category).toBe('requirements');
    expect(evals[0].mode).toBe('llm');
    expect(evals[0].score).toBeNull();
  });

  it('filters evaluations by project', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-eval-'));
    const db = createDatabase(dataDir);

    const now = new Date().toISOString();
    db.saveEvaluation({ id: 'eval-1', projectId: 'proj-1', runId: 'r1', category: 'requirements', mode: 'llm', inputSnapshot: {}, outputSnapshot: {}, score: null, notes: '', createdAt: now });
    db.saveEvaluation({ id: 'eval-2', projectId: 'proj-2', runId: 'r2', category: 'matching', mode: 'rule', inputSnapshot: {}, outputSnapshot: {}, score: null, notes: '', createdAt: now });

    expect(db.getEvaluations('proj-1')).toHaveLength(1);
    expect(db.getEvaluations('proj-2')).toHaveLength(1);
    expect(db.getEvaluations('proj-3')).toHaveLength(0);
  });

  it('updates evaluation score and notes', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'solution-orch-agent-eval-'));
    const db = createDatabase(dataDir);

    const now = new Date().toISOString();
    db.saveEvaluation({ id: 'eval-1', projectId: 'proj-1', runId: 'r1', category: 'requirements', mode: 'llm', inputSnapshot: {}, outputSnapshot: {}, score: null, notes: '', createdAt: now });

    const updated = db.updateEvaluationScore('eval-1', 85, '需求提取准确');
    expect(updated).not.toBeNull();
    expect(updated!.score).toBe(85);
    expect(updated!.notes).toBe('需求提取准确');

    // Verify persist
    const evals = db.getEvaluations('proj-1');
    expect(evals[0].score).toBe(85);
    expect(evals[0].notes).toBe('需求提取准确');
  });
});
