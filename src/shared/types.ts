export type DocumentKind = 'requirement' | 'product' | 'reference';

export type RequirementPriority = 'must' | 'should' | 'nice';

export type MatchStatus = 'matched' | 'partial' | 'gap';

export interface ParsedDocument {
  id?: string;
  kind: DocumentKind;
  fileName: string;
  text: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface StoredDocument extends ParsedDocument {
  id: string;
  projectId: string;
  storagePath: string;
  mimeType: string;
  createdAt: string;
}

export interface RequirementItem {
  id: string;
  title: string;
  description: string;
  priority: RequirementPriority;
  sourceDocumentId: string;
  sourceExcerpt: string;
}

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  fileName: string;
  content: string;
  keywords: string[];
}

export interface ProductMatch {
  id: string;
  requirementId: string;
  status: MatchStatus;
  score: number;
  rationale: string;
  evidence: string[];
}

export interface DraftArtifact {
  id: string;
  type: 'solution' | 'bid';
  title: string;
  content: string;
  updatedAt: string;
}

export interface DraftBundle {
  solution: DraftArtifact;
  bid: DraftArtifact;
}

export interface ReviewFinding {
  id: string;
  type: 'coverage' | 'risk' | 'evidence' | 'format';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  target?: string;
}

export interface WorkflowInput {
  projectId: string;
  documents: ParsedDocument[];
}

export interface WorkflowResult {
  projectId: string;
  requirements: RequirementItem[];
  knowledgeChunks: KnowledgeChunk[];
  matches: ProductMatch[];
  drafts: DraftBundle;
  reviewFindings: ReviewFinding[];
  completedAt: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  status: 'draft' | 'running' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
}

