import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDatabase } from './storage/database';
import { parseDocumentAsset } from './services/documentParser';
import { runBidWorkflow } from './mastra/bidWorkflow';
import { exportDraftsToDocx } from './services/exportDocx';
import type { DocumentKind } from './shared/types';

const host = process.env.API_HOST ?? '127.0.0.1';
const port = Number(process.env.API_PORT ?? 8787);
const dataDir = process.env.DATA_DIR ?? '.data';
const uploadDir = join(dataDir, 'uploads');
mkdirSync(uploadDir, { recursive: true });
const db = createDatabase(dataDir);

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
  const projectId = matchProjectPath(url.pathname);

  if (method === 'GET' && url.pathname === '/api/health') {
    return sendJson(response, 200, { ok: true });
  }

  if (method === 'GET' && url.pathname === '/api/projects') {
    return sendJson(response, 200, db.listProjects());
  }

  if (method === 'POST' && url.pathname === '/api/projects') {
    const body = await readJson<{ name?: string }>(request);
    return sendJson(response, 201, db.createProject(body.name ?? '新投标项目'));
  }

  if (!projectId) {
    return sendJson(response, 404, { error: 'not found' });
  }

  const project = db.getProject(projectId);
  if (!project) {
    return sendJson(response, 404, { error: 'project not found' });
  }

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
