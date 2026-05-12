import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type {
  DraftArtifact,
  ProductMatch,
  ProjectRecord,
  RequirementItem,
  ReviewFinding,
  StoredDocument,
  WorkflowResult
} from '../shared/types';

export interface AppDatabase {
  createProject(name: string): ProjectRecord;
  listProjects(): ProjectRecord[];
  getProject(id: string): ProjectRecord | null;
  updateProjectStatus(id: string, status: ProjectRecord['status']): void;
  saveDocument(document: Omit<StoredDocument, 'id' | 'createdAt'>): StoredDocument;
  listDocuments(projectId: string): StoredDocument[];
  saveWorkflowResult(result: WorkflowResult): void;
  getRequirements(projectId: string): RequirementItem[];
  getMatches(projectId: string): ProductMatch[];
  getDrafts(projectId: string): DraftArtifact[];
  updateDraft(projectId: string, draftId: string, content: string): DraftArtifact | null;
  getReviewFindings(projectId: string): ReviewFinding[];
}

export function createDatabase(dataDir = process.env.DATA_DIR ?? '.data'): AppDatabase {
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'app.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  ensureSchema(db);

  return {
    createProject(name) {
      const now = new Date().toISOString();
      const project: ProjectRecord = {
        id: randomUUID(),
        name: name.trim() || '未命名项目',
        status: 'draft',
        createdAt: now,
        updatedAt: now
      };
      db.prepare(
        'INSERT INTO projects (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      ).run(project.id, project.name, project.status, project.createdAt, project.updatedAt);
      return project;
    },

    listProjects() {
      return db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all().map(toProject);
    },

    getProject(id) {
      const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
      return row ? toProject(row) : null;
    },

    updateProjectStatus(id, status) {
      db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run(
        status,
        new Date().toISOString(),
        id
      );
    },

    saveDocument(document) {
      const stored: StoredDocument = {
        ...document,
        id: randomUUID(),
        createdAt: new Date().toISOString()
      };
      db.prepare(
        `INSERT INTO documents
          (id, project_id, kind, file_name, mime_type, storage_path, text, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        stored.id,
        stored.projectId,
        stored.kind,
        stored.fileName,
        stored.mimeType,
        stored.storagePath,
        stored.text,
        JSON.stringify(stored.metadata ?? {}),
        stored.createdAt
      );
      return stored;
    },

    listDocuments(projectId) {
      return db.prepare('SELECT * FROM documents WHERE project_id = ? ORDER BY created_at ASC').all(projectId).map(toDocument);
    },

    saveWorkflowResult(result) {
      const now = new Date().toISOString();
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM requirements WHERE project_id = ?').run(result.projectId);
        db.prepare('DELETE FROM matches WHERE project_id = ?').run(result.projectId);
        db.prepare('DELETE FROM drafts WHERE project_id = ?').run(result.projectId);
        db.prepare('DELETE FROM review_findings WHERE project_id = ?').run(result.projectId);
        db.prepare('DELETE FROM workflow_runs WHERE project_id = ?').run(result.projectId);

        for (const requirement of result.requirements) {
          db.prepare(
            `INSERT INTO requirements
              (id, project_id, title, description, priority, source_document_id, source_excerpt)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(
            requirement.id,
            result.projectId,
            requirement.title,
            requirement.description,
            requirement.priority,
            requirement.sourceDocumentId,
            requirement.sourceExcerpt
          );
        }

        for (const match of result.matches) {
          db.prepare(
            `INSERT INTO matches
              (id, project_id, requirement_id, status, score, rationale, evidence_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(
            match.id,
            result.projectId,
            match.requirementId,
            match.status,
            match.score,
            match.rationale,
            JSON.stringify(match.evidence)
          );
        }

        for (const draft of [result.drafts.solution, result.drafts.bid]) {
          db.prepare(
            `INSERT INTO drafts
              (id, project_id, type, title, content, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(draft.id, result.projectId, draft.type, draft.title, draft.content, draft.updatedAt);
        }

        for (const finding of result.reviewFindings) {
          db.prepare(
            `INSERT INTO review_findings
              (id, project_id, type, severity, title, detail, target)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(
            finding.id,
            result.projectId,
            finding.type,
            finding.severity,
            finding.title,
            finding.detail,
            finding.target ?? ''
          );
        }

        db.prepare(
          'INSERT INTO workflow_runs (id, project_id, result_json, created_at) VALUES (?, ?, ?, ?)'
        ).run(randomUUID(), result.projectId, JSON.stringify(result), now);
        db.prepare('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?').run('completed', now, result.projectId);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },

    getRequirements(projectId) {
      return db.prepare('SELECT * FROM requirements WHERE project_id = ? ORDER BY rowid ASC').all(projectId).map(toRequirement);
    },

    getMatches(projectId) {
      return db.prepare('SELECT * FROM matches WHERE project_id = ? ORDER BY rowid ASC').all(projectId).map(toMatch);
    },

    getDrafts(projectId) {
      return db.prepare('SELECT * FROM drafts WHERE project_id = ? ORDER BY type DESC').all(projectId).map(toDraft);
    },

    updateDraft(projectId, draftId, content) {
      const updatedAt = new Date().toISOString();
      db.prepare('UPDATE drafts SET content = ?, updated_at = ? WHERE project_id = ? AND id = ?').run(
        content,
        updatedAt,
        projectId,
        draftId
      );
      const row = db.prepare('SELECT * FROM drafts WHERE project_id = ? AND id = ?').get(projectId, draftId);
      return row ? toDraft(row) : null;
    },

    getReviewFindings(projectId) {
      return db.prepare('SELECT * FROM review_findings WHERE project_id = ? ORDER BY rowid ASC').all(projectId).map(toFinding);
    }
  };
}

function ensureSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      text TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS requirements (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      priority TEXT NOT NULL,
      source_document_id TEXT NOT NULL,
      source_excerpt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      requirement_id TEXT NOT NULL,
      status TEXT NOT NULL,
      score REAL NOT NULL,
      rationale TEXT NOT NULL,
      evidence_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_findings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT NOT NULL,
      target TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function toProject(row: unknown): ProjectRecord {
  const record = row as Record<string, string>;
  return {
    id: record.id,
    name: record.name,
    status: record.status as ProjectRecord['status'],
    createdAt: record.created_at,
    updatedAt: record.updated_at
  };
}

function toDocument(row: unknown): StoredDocument {
  const record = row as Record<string, string>;
  return {
    id: record.id,
    projectId: record.project_id,
    kind: record.kind as StoredDocument['kind'],
    fileName: record.file_name,
    mimeType: record.mime_type,
    storagePath: record.storage_path,
    text: record.text,
    metadata: JSON.parse(record.metadata_json),
    createdAt: record.created_at
  };
}

function toRequirement(row: unknown): RequirementItem {
  const record = row as Record<string, string>;
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    priority: record.priority as RequirementItem['priority'],
    sourceDocumentId: record.source_document_id,
    sourceExcerpt: record.source_excerpt
  };
}

function toMatch(row: unknown): ProductMatch {
  const record = row as Record<string, string>;
  return {
    id: record.id,
    requirementId: record.requirement_id,
    status: record.status as ProductMatch['status'],
    score: Number(record.score),
    rationale: record.rationale,
    evidence: JSON.parse(record.evidence_json)
  };
}

function toDraft(row: unknown): DraftArtifact {
  const record = row as Record<string, string>;
  return {
    id: record.id,
    type: record.type as DraftArtifact['type'],
    title: record.title,
    content: record.content,
    updatedAt: record.updated_at
  };
}

function toFinding(row: unknown): ReviewFinding {
  const record = row as Record<string, string>;
  return {
    id: record.id,
    type: record.type as ReviewFinding['type'],
    severity: record.severity as ReviewFinding['severity'],
    title: record.title,
    detail: record.detail,
    target: record.target || undefined
  };
}
