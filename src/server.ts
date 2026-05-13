import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase, type EvaluationRecord } from './storage/database';
import { parseDocumentAsset } from './services/documentParser';
import { runBidWorkflow, runBidWorkflowWithProgress, WORKFLOW_STEPS } from './mastra/bidWorkflow';
import { chatStream } from './agents/chatAgent';
import { createVectorStore } from './services/vectorStore';
import { exportDraftsToDocx } from './services/exportDocx';
import type { DocumentKind } from './shared/types';
import { extractAuth, requireRole, type Role } from './auth/middleware';
import { createAuthRoutes } from './auth/routes';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? '.data';
const uploadDir = join(dataDir, 'uploads');
mkdirSync(uploadDir, { recursive: true });
const db = createDatabase(dataDir);
const vectorStore = createVectorStore(db);

const authRoutes = createAuthRoutes(db);

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : 'unknown error'
    });
  }
});

server.listen(port, host, () => {
  console.log(`API listening on http://${host}:${port}`);
});

async function route(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`);
  const method = request.method ?? 'GET';

  // Auth routes (before projectId check)
  if (method === 'POST' && url.pathname === '/api/auth/login') return authRoutes.login(request, response);
  if (method === 'POST' && url.pathname === '/api/auth/register') return authRoutes.register(request, response);

  // Extract auth context
  const auth = extractAuth(request, db);

  const projectId = matchProjectPath(url.pathname);

  // Helper to check role for current project
  function checkAccess(projectId: string, minRole: Role): boolean {
    if (!auth) return true; // auth disabled
    return requireRole(db, projectId, auth.user.id, minRole);
  }

  if (method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, { ok: true });
  }

  if (method === 'GET' && url.pathname === '/api/projects') {
    return sendJson(response, 200, db.listProjects(auth?.user.id));
  }

  if (method === 'POST' && url.pathname === '/api/projects') {
    const body = await readJson<{ name?: string }>(request);
    return sendJson(response, 201, db.createProject(body.name ?? '新投标项目', auth?.user.id));
  }

  // Global eval patch (no project prefix needed)
  const evalPatchGlobal = url.pathname.match(/^\/api\/evaluations\/([^/]+)$/);
  if (method === 'PATCH' && evalPatchGlobal) {
    const body = await readJson<{ score?: number; notes?: string }>(request);
    const updated = db.updateEvaluationScore(evalPatchGlobal[1], body.score ?? null, body.notes ?? '');
    return updated ? sendJson(response, 200, updated) : sendJson(response, 404, { error: 'evaluation not found' });
  }

  if (!projectId) {
    return sendJson(response, 404, { error: 'not found' });
  }

  const project = db.getProject(projectId);
  if (!project) {
    return sendJson(response, 404, { error: 'project not found' });
  }

  // Access check: viewer or above
  if (auth && !checkAccess(projectId, 'viewer')) {
    return sendJson(response, 403, { error: 'forbidden' });
  }

  const isEditor = checkAccess(projectId, 'editor');
  const isOwner = checkAccess(projectId, 'owner');

  if (method === 'GET' && url.pathname === `/api/projects/${projectId}`) {
    return sendJson(response, 200, {
      project,
      documents: db.listDocuments(projectId).map(toPublicDocument),
      requirements: db.getRequirements(projectId),
      matches: db.getMatches(projectId),
      drafts: db.getDrafts(projectId),
      reviewFindings: db.getReviewFindings(projectId)
    });
  }

  if (method === 'POST' && url.pathname === `/api/projects/${projectId}/documents`) {
    if (!isEditor) return sendJson(response, 403, { error: 'forbidden' });
    const upload = await parseMultipart(request);
    const kind = asDocumentKind(upload.fields.kind ?? 'requirement');
    const file = upload.files[0];

    if (!file) {
      return sendJson(response, 400, { error: 'file is required' });
    }

    const storageName = `${randomUUID()}-${basename(file.fileName)}`;
    const storagePath = join(uploadDir, storageName);
    writeFileSync(storagePath, file.buffer);
    const parsed = await parseDocumentAsset({
      fileName: file.fileName,
      mimeType: file.mimeType,
      buffer: file.buffer,
      kind
    });
    const stored = db.saveDocument({
      projectId,
      kind,
      fileName: parsed.metadata.fileName,
      mimeType: file.mimeType,
      storagePath,
      text: parsed.text,
      metadata: parsed.metadata
    });
    return sendJson(response, 201, toPublicDocument(stored));
  }

  if (method === 'POST' && url.pathname === `/api/projects/${projectId}/run`) {
    if (!isEditor) return sendJson(response, 403, { error: 'forbidden' });
    db.updateProjectStatus(projectId, 'running');
    const documents = db.listDocuments(projectId).map((document) => ({
      id: document.id,
      kind: document.kind,
      fileName: document.fileName,
      text: document.text,
      metadata: document.metadata
    }));
    const result = await runBidWorkflow({ projectId, documents });
    db.saveWorkflowResult(result);
    return sendJson(response, 200, result);
  }

  if (method === 'GET' && url.pathname === `/api/projects/${projectId}/run/stream`) {
    if (!isEditor) return sendJson(response, 403, { error: 'forbidden' });
    db.updateProjectStatus(projectId, 'running');
    const documents = db.listDocuments(projectId).map((document) => ({
      id: document.id,
      kind: document.kind,
      fileName: document.fileName,
      text: document.text,
      metadata: document.metadata
    }));

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });

    // Send step list first
    response.write(`event: steps\ndata: ${JSON.stringify(WORKFLOW_STEPS)}\n\n`);

    try {
      const { result, evalSnapshots } = await runBidWorkflowWithProgress(
        { projectId, documents },
        (progress) => {
          response.write(`event: progress\ndata: ${JSON.stringify(progress)}\n\n`);
        },
        { vectorStore, getPreviousRunContext: () => db.getPreviousRunContext(projectId) },
      );
      db.saveWorkflowResult(result);

      // Save evaluation snapshots
      const runId = randomUUID();
      const now = new Date().toISOString();
      for (const snapshot of evalSnapshots) {
        db.saveEvaluation({
          id: randomUUID(),
          projectId,
          runId,
          category: snapshot.category,
          mode: snapshot.mode,
          inputSnapshot: snapshot.input,
          outputSnapshot: snapshot.output,
          score: null,
          notes: '',
          createdAt: now,
        });
      }

      response.write(`event: complete\ndata: ${JSON.stringify(result)}\n\n`);
    } catch (error) {
      response.write(`event: error\ndata: ${JSON.stringify({ error: error instanceof Error ? error.message : 'unknown error' })}\n\n`);
    } finally {
      response.end();
    }
    return;
  }

  if (method === 'POST' && url.pathname === `/api/projects/${projectId}/chat`) {
    const body = await readJson<{ message?: string }>(request);
    const message = body.message ?? '';

    if (!message.trim()) {
      return sendJson(response, 400, { error: 'message is required' });
    }

    const requirements = db.getRequirements(projectId);
    const matches = db.getMatches(projectId);
    const drafts = db.getDrafts(projectId);
    const reviewFindings = db.getReviewFindings(projectId);

    const history = db.getChatMessages(projectId, 30).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });

    let fullContent = '';

    await chatStream(
      message,
      { requirements, matches, drafts: { solution: drafts[0] ?? null, bid: drafts[1] ?? null }, reviewFindings },
      history,
      (chunk) => {
        fullContent += chunk;
        response.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      },
      () => {
        db.saveChatMessage(projectId, 'user', message);
        db.saveChatMessage(projectId, 'assistant', fullContent);
        response.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        response.end();
      },
      (error) => {
        response.write(`data: ${JSON.stringify({ error })}\n\n`);
        response.end();
      }
    );

    return;
  }

  if (method === 'GET' && url.pathname === `/api/projects/${projectId}/requirements`) {
    return sendJson(response, 200, db.getRequirements(projectId));
  }

  if (method === 'GET' && url.pathname === `/api/projects/${projectId}/matches`) {
    return sendJson(response, 200, db.getMatches(projectId));
  }

  if (method === 'GET' && url.pathname === `/api/projects/${projectId}/drafts`) {
    return sendJson(response, 200, db.getDrafts(projectId));
  }

  const draftPatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/drafts\/([^/]+)$/);
  if (method === 'PATCH' && draftPatch) {
    if (!isEditor) return sendJson(response, 403, { error: 'forbidden' });
    const body = await readJson<{ content?: string }>(request);
    const updated = db.updateDraft(projectId, draftPatch[2], body.content ?? '');
    return updated ? sendJson(response, 200, updated) : sendJson(response, 404, { error: 'draft not found' });
  }

  if (method === 'GET' && url.pathname === `/api/projects/${projectId}/review`) {
    return sendJson(response, 200, db.getReviewFindings(projectId));
  }

  if (method === 'POST' && url.pathname === `/api/projects/${projectId}/export/docx`) {
    const buffer = await exportDraftsToDocx(db.getDrafts(projectId));
    response.writeHead(200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'content-disposition': 'attachment; filename="solution-bid-draft.docx"'
    });
    return response.end(buffer);
  }

  if (method === 'GET' && url.pathname === `/api/projects/${projectId}/evaluations`) {
    return sendJson(response, 200, db.getEvaluations(projectId));
  }

  if (method === 'GET' && url.pathname === `/api/projects/${projectId}/members`) {
    return sendJson(response, 200, db.getProjectMembers(projectId));
  }

  if (method === 'POST' && url.pathname === `/api/projects/${projectId}/members`) {
    if (!isOwner) return sendJson(response, 403, { error: 'forbidden' });
    const body = await readJson<{ userId?: string; role?: string }>(request);
    if (!body.userId || !body.role) return sendJson(response, 400, { error: 'userId and role required' });
    if (!['editor', 'viewer'].includes(body.role)) return sendJson(response, 400, { error: 'role must be editor or viewer' });
    return sendJson(response, 201, db.addProjectMember(projectId, body.userId, body.role as 'editor' | 'viewer'));
  }

  if (method === 'DELETE' && url.pathname.match(/^\/api\/projects\/[^/]+\/members\/[^/]+$/)) {
    if (!isOwner) return sendJson(response, 403, { error: 'forbidden' });
    const memberId = url.pathname.split('/').pop()!;
    db.removeProjectMember(projectId, memberId);
    return sendJson(response, 200, { ok: true });
  }

  if (method === 'DELETE' && url.pathname === `/api/projects/${projectId}`) {
    if (!isOwner) return sendJson(response, 403, { error: 'forbidden' });
    db.updateProjectStatus(projectId, 'failed');
    return sendJson(response, 200, { ok: true });
  }

  return sendJson(response, 404, { error: 'not found' });
}

function matchProjectPath(pathname: string): string | null {
  const match = pathname.match(/^\/api\/projects\/([^/]+)/);
  return match?.[1] ?? null;
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8'
  });
  response.end(JSON.stringify(payload));
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) as T : {} as T;
}

async function parseMultipart(request: IncomingMessage) {
  const contentType = request.headers['content-type'] ?? '';
  const boundary = contentType.match(/boundary=(.+)$/)?.[1];

  if (!boundary) {
    throw new Error('multipart boundary missing');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks);
  const marker = Buffer.from(`--${boundary}`);
  const parts = raw.toString('binary').split(marker.toString('binary')).slice(1, -1);
  const fields: Record<string, string> = {};
  const files: Array<{ fieldName: string; fileName: string; mimeType: string; buffer: Buffer }> = [];

  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const [rawHeaders, body = ''] = trimmed.split('\r\n\r\n');
    const disposition = rawHeaders.match(/Content-Disposition: form-data; name="([^"]+)"(?:; filename="([^"]+)")?/i);
    const mimeType = rawHeaders.match(/Content-Type: ([^\r\n]+)/i)?.[1] ?? 'application/octet-stream';
    const fieldName = disposition?.[1];
    const fileName = disposition?.[2];

    if (!fieldName) {
      continue;
    }

    if (fileName) {
      files.push({
        fieldName,
        fileName,
        mimeType,
        buffer: Buffer.from(body, 'binary')
      });
    } else {
      fields[fieldName] = Buffer.from(body, 'binary').toString('utf8').trim();
    }
  }

  return { fields, files };
}

function asDocumentKind(value: string): DocumentKind {
  if (value === 'product' || value === 'reference') {
    return value;
  }
  return 'requirement';
}

function toPublicDocument<T extends { storagePath: string }>(document: T): Omit<T, 'storagePath'> & { storagePath: '' } {
  return {
    ...document,
    storagePath: ''
  };
}
