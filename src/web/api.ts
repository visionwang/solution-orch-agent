import type { DraftArtifact, ProductMatch, ProjectRecord, RequirementItem, ReviewFinding, StoredDocument } from '../shared/types';

export interface ProjectDetail {
  project: ProjectRecord;
  documents: StoredDocument[];
  requirements: RequirementItem[];
  matches: ProductMatch[];
  drafts: DraftArtifact[];
  reviewFindings: ReviewFinding[];
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return getJson('/api/projects');
}

export async function createProject(name: string): Promise<ProjectRecord> {
  return getJson('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name })
  });
}

export async function getProject(projectId: string): Promise<ProjectDetail> {
  return getJson(`/api/projects/${projectId}`);
}

export async function uploadDocument(projectId: string, kind: string, file: File): Promise<StoredDocument> {
  const body = new FormData();
  body.set('kind', kind);
  body.set('file', file);
  return getJson(`/api/projects/${projectId}/documents`, {
    method: 'POST',
    body
  });
}

export async function runProject(projectId: string) {
  return getJson(`/api/projects/${projectId}/run`, { method: 'POST' });
}

export async function updateDraft(projectId: string, draftId: string, content: string): Promise<DraftArtifact> {
  return getJson(`/api/projects/${projectId}/drafts/${draftId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content })
  });
}

export function docxExportUrl(projectId: string): string {
  return `/api/projects/${projectId}/export/docx`;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || response.statusText);
  }
  return response.json() as Promise<T>;
}

