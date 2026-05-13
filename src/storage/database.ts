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

export interface StoredVectorChunk {
  id: string;
  documentId: string;
  content: string;
  embedding: number[];
  createdAt: string;
}

export interface EvaluationRecord {
  id: string;
  projectId: string;
  runId: string;
  category: string;
  mode: string;
  inputSnapshot: unknown;
  outputSnapshot: unknown;
  score: number | null;
  notes: string;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string;
  createdAt: string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: 'owner' | 'editor' | 'viewer';
  addedAt: string;
}

export interface AppDatabase {
  createProject(name: string, ownerId?: string): ProjectRecord;
  listProjects(userId?: string): ProjectRecord[];
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
  saveVectorChunk(chunk: StoredVectorChunk): void;
  getVectorChunks(): StoredVectorChunk[];
  clearVectorChunks(): void;
  saveEvaluation(evaluation: EvaluationRecord): void;
  getEvaluations(projectId: string): EvaluationRecord[];
  updateEvaluationScore(id: string, score: number | null, notes: string): EvaluationRecord | null;
  createUser(username: string, passwordHash: string, displayName: string): UserRecord;
  getUserByUsername(username: string): UserRecord | null;
  getUserById(id: string): UserRecord | null;
  addProjectMember(projectId: string, userId: string, role: ProjectMember['role']): ProjectMember;
  getProjectMembers(projectId: string): ProjectMember[];
  getProjectRole(projectId: string, userId: string): ProjectMember['role'] | null;
  removeProjectMember(projectId: string, userId: string): void;
  saveChatMessage(projectId: string, role: string, content: string): void;
  getChatMessages(projectId: string, limit?: number): Array<{ role: string; content: string; createdAt: string }>;
  clearChatMessages(projectId: string): void;
  getPreviousRunContext(projectId: string): { requirements: number; matches: Record<string, number>; findings: number; lastRunAt: string | null } | null;
}

export function createDatabase(dataDir = process.env.DATA_DIR ?? '.data'): AppDatabase {
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'app.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  ensureSchema(db);

  return {
    createProject(name, ownerId) {
      const now = new Date().toISOString();
      const project: ProjectRecord = {
        id: randomUUID(),
        name: name.trim() || '未命名项目',
        status: 'draft',
        createdAt: now,
        updatedAt: now
      };
      db.prepare(
        'INSERT INTO projects (id, name, status, owner_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(project.id, project.name, project.status, ownerId ?? null, project.createdAt, project.updatedAt);
      if (ownerId) {
        db.prepare(
          'INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)'
        ).run(project.id, ownerId, 'owner', now);
      }
      return project;
    },

    listProjects(userId) {
      if (userId) {
        const rows = db.prepare(
          'SELECT p.* FROM projects p INNER JOIN project_members m ON p.id = m.project_id WHERE m.user_id = ? ORDER BY p.updated_at DESC'
        ).all(userId);
        return rows.map(toProject);
      }
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
    },

    saveVectorChunk(chunk) {
      db.prepare(
        'INSERT INTO vector_chunks (id, document_id, content, embedding, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(chunk.id, chunk.documentId, chunk.content, JSON.stringify(chunk.embedding), chunk.createdAt);
    },

    getVectorChunks() {
      const rows = db.prepare('SELECT * FROM vector_chunks ORDER BY rowid ASC').all();
      return rows.map((row: unknown) => {
        const r = row as Record<string, string>;
        return {
          id: r.id,
          documentId: r.document_id,
          content: r.content,
          embedding: JSON.parse(r.embedding) as number[],
          createdAt: r.created_at,
        };
      });
    },

    clearVectorChunks() {
      db.exec('DELETE FROM vector_chunks');
    },

    saveEvaluation(evaluation) {
      db.prepare(
        'INSERT INTO evaluations (id, project_id, run_id, category, mode, input_snapshot, output_snapshot, score, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(
        evaluation.id,
        evaluation.projectId,
        evaluation.runId,
        evaluation.category,
        evaluation.mode,
        JSON.stringify(evaluation.inputSnapshot),
        JSON.stringify(evaluation.outputSnapshot),
        evaluation.score,
        evaluation.notes,
        evaluation.createdAt,
      );
    },

    getEvaluations(projectId) {
      const rows = db.prepare('SELECT * FROM evaluations WHERE project_id = ? ORDER BY created_at DESC').all(projectId);
      return rows.map((row: unknown) => {
        const r = row as Record<string, string>;
        return {
          id: r.id,
          projectId: r.project_id,
          runId: r.run_id,
          category: r.category,
          mode: r.mode,
          inputSnapshot: JSON.parse(r.input_snapshot),
          outputSnapshot: JSON.parse(r.output_snapshot),
          score: r.score !== null ? Number(r.score) : null,
          notes: r.notes,
          createdAt: r.created_at,
        };
      });
    },

    updateEvaluationScore(id, score, notes) {
      db.prepare('UPDATE evaluations SET score = ?, notes = ? WHERE id = ?').run(score, notes, id);
      const row = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id);
      if (!row) return null;
      const r = row as Record<string, string>;
      return {
        id: r.id,
        projectId: r.project_id,
        runId: r.run_id,
        category: r.category,
        mode: r.mode,
        inputSnapshot: JSON.parse(r.input_snapshot),
        outputSnapshot: JSON.parse(r.output_snapshot),
        score: r.score !== null ? Number(r.score) : null,
        notes: r.notes,
        createdAt: r.created_at,
      };
    },

    createUser(username, passwordHash, displayName) {
      const now = new Date().toISOString();
      const user: UserRecord = { id: randomUUID(), username, passwordHash, displayName, createdAt: now };
      db.prepare(
        'INSERT INTO users (id, username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?, ?)'
      ).run(user.id, user.username, user.passwordHash, user.displayName, user.createdAt);
      return user;
    },

    getUserByUsername(username) {
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      return row ? toUser(row) : null;
    },

    getUserById(id) {
      const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      return row ? toUser(row) : null;
    },

    addProjectMember(projectId, userId, role) {
      const now = new Date().toISOString();
      db.prepare(
        'INSERT OR REPLACE INTO project_members (project_id, user_id, role, added_at) VALUES (?, ?, ?, ?)'
      ).run(projectId, userId, role, now);
      return { projectId, userId, role, addedAt: now };
    },

    getProjectMembers(projectId) {
      const rows = db.prepare('SELECT * FROM project_members WHERE project_id = ?').all(projectId);
      return rows.map(toMember);
    },

    getProjectRole(projectId, userId) {
      const row = db.prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?').get(projectId, userId);
      return row ? (row as Record<string, string>).role as ProjectMember['role'] : null;
    },

    removeProjectMember(projectId, userId) {
      db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(projectId, userId);
    },

    saveChatMessage(projectId, role, content) {
      db.prepare(
        'INSERT INTO conversations (project_id, role, content, created_at) VALUES (?, ?, ?, ?)'
      ).run(projectId, role, content, new Date().toISOString());
    },

    getChatMessages(projectId, limit = 50) {
      const rows = db.prepare(
        'SELECT role, content, created_at FROM conversations WHERE project_id = ? ORDER BY id ASC LIMIT ?'
      ).all(projectId, limit);
      return rows.map((row: unknown) => {
        const r = row as Record<string, string>;
        return { role: r.role, content: r.content, createdAt: r.created_at };
      });
    },

    clearChatMessages(projectId) {
      db.prepare('DELETE FROM conversations WHERE project_id = ?').run(projectId);
    },

    getPreviousRunContext(projectId) {
      const runRow = db.prepare(
        'SELECT result_json, created_at FROM workflow_runs WHERE project_id = ? ORDER BY created_at DESC LIMIT 1'
      ).get(projectId);
      if (!runRow) return null;
      const r = runRow as Record<string, string>;
      try {
        const result = JSON.parse(r.result_json);
        const matchSummary: Record<string, number> = {};
        for (const m of result.matches ?? []) {
          matchSummary[m.status] = (matchSummary[m.status] ?? 0) + 1;
        }
        return {
          requirements: (result.requirements ?? []).length,
          matches: matchSummary,
          findings: (result.reviewFindings ?? []).length,
          lastRunAt: r.created_at,
        };
      } catch {
        return null;
      }
    },
  };
}

function ensureSchema(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      status TEXT NOT NULL,
      owner_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_members (
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      added_at TEXT NOT NULL,
      PRIMARY KEY (project_id, user_id)
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
    CREATE TABLE IF NOT EXISTS vector_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evaluations (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      category TEXT NOT NULL,
      mode TEXT NOT NULL,
      input_snapshot TEXT NOT NULL,
      output_snapshot TEXT NOT NULL,
      score REAL,
      notes TEXT NOT NULL,
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

function toUser(row: unknown): UserRecord {
  const r = row as Record<string, string>;
  return { id: r.id, username: r.username, passwordHash: r.password_hash, displayName: r.display_name, createdAt: r.created_at };
}

function toMember(row: unknown): ProjectMember {
  const r = row as Record<string, string>;
  return { projectId: r.project_id, userId: r.user_id, role: r.role as ProjectMember['role'], addedAt: r.added_at };
}
