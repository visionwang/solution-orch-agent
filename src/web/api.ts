import type { DraftArtifact, ProductMatch, ProjectRecord, RequirementItem, ReviewFinding, StoredDocument } from '../shared/types';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
}

interface AuthResponse {
  token: string;
  user: AuthUser;
}

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

export function getStoredToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): AuthUser | null {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) as AuthUser : null;
}

function saveAuth(data: AuthResponse) {
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const data = await getJson<AuthResponse>('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  saveAuth(data);
  return data.user;
}

export async function register(username: string, password: string, displayName: string): Promise<AuthUser> {
  const data = await getJson<AuthResponse>('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password, displayName }),
  });
  saveAuth(data);
  return data.user;
}

export interface EvaluationItem {
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

export interface ProjectDetail {
  project: ProjectRecord;
  documents: StoredDocument[];
  requirements: RequirementItem[];
  matches: ProductMatch[];
  drafts: DraftArtifact[];
  reviewFindings: ReviewFinding[];
}

export async function getEvaluations(projectId: string): Promise<EvaluationItem[]> {
  return getJson(`/api/projects/${projectId}/evaluations`);
}

export async function updateEvaluation(evalId: string, score: number | null, notes: string): Promise<EvaluationItem> {
  return getJson(`/api/evaluations/${evalId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ score, notes }),
  });
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

export type StepStatus = 'pending' | 'running' | 'success' | 'failed';
export type StepInfo = { stepId: string; label: string };

export function runProjectStream(
  projectId: string,
  callbacks: {
    onSteps?: (steps: StepInfo[]) => void;
    onProgress?: (stepId: string, status: StepStatus, label: string, error?: string) => void;
    onComplete?: (result: unknown) => void;
    onError?: (error: string) => void;
  }
): () => void {
  const eventSource = new EventSource(`/api/projects/${projectId}/run/stream`);

  eventSource.addEventListener('steps', (event) => {
    const steps = JSON.parse(event.data) as StepInfo[];
    callbacks.onSteps?.(steps);
  });

  eventSource.addEventListener('progress', (event) => {
    const data = JSON.parse(event.data) as { stepId: string; status: StepStatus; label: string; error?: string };
    callbacks.onProgress?.(data.stepId, data.status, data.label, data.error);
  });

  eventSource.addEventListener('complete', (event) => {
    callbacks.onComplete?.(JSON.parse(event.data));
    eventSource.close();
  });

  eventSource.addEventListener('error', (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data);
      callbacks.onError?.(data.error ?? '流程执行出错');
    } catch {
      callbacks.onError?.('连接中断');
    }
    eventSource.close();
  });

  eventSource.onerror = () => {
    callbacks.onError?.('连接中断');
    eventSource.close();
  };

  return () => eventSource.close();
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

export function chatStream(
  projectId: string,
  message: string,
  callbacks: {
    onChunk: (chunk: string) => void;
    onDone: () => void;
    onError: (error: string) => void;
  }
): () => void {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(`/api/projects/${projectId}/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });

      if (!response.ok) {
        callbacks.onError(`请求失败 (${response.status})`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError('无法读取响应');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(trimmed.slice(6));
            if (data.chunk) callbacks.onChunk(data.chunk);
            if (data.error) callbacks.onError(data.error);
            if (data.done) callbacks.onDone();
          } catch { /* skip */ }
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      callbacks.onError(error instanceof Error ? error.message : '未知错误');
    }
  })();

  return () => controller.abort();
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || response.statusText);
  }
  return response.json() as Promise<T>;
}

