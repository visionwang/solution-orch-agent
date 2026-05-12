import type { WorkflowInput, WorkflowResult } from '../shared/types';
import { extractRequirements } from '../agents/requirementAnalyst';
import { indexProductKnowledge } from '../agents/productKnowledge';
import { matchProducts } from '../agents/productMatcher';
import { generateDrafts } from '../agents/draftWriters';
import { reviewDrafts } from '../agents/reviewAgent';
import { safeJson } from '../shared/security';

export const bidWorkflowMetadata = {
  id: 'solution-orch-bid-workflow',
  steps: [
    'document-ingestion',
    'requirement-analysis',
    'product-knowledge-indexing',
    'product-matching',
    'draft-generation',
    'ai-review'
  ]
} as const;

export async function runBidWorkflow(input: WorkflowInput): Promise<WorkflowResult> {
  const requirements = extractRequirements(input.documents);
  const knowledgeChunks = indexProductKnowledge(input.documents);
  const matches = matchProducts(requirements, knowledgeChunks);
  const drafts = generateDrafts(requirements, matches);
  const reviewFindings = reviewDrafts(drafts, requirements, matches);

  return safeJson({
    projectId: input.projectId,
    requirements,
    knowledgeChunks,
    matches,
    drafts,
    reviewFindings,
    completedAt: new Date().toISOString()
  });
}

export async function tryCreateMastraRuntime() {
  try {
    const mastraModule = await import('@mastra/core/mastra');
    return {
      available: true,
      mastraModule,
      workflow: bidWorkflowMetadata
    };
  } catch {
    return {
      available: false,
      mastraModule: null,
      workflow: bidWorkflowMetadata
    };
  }
}

