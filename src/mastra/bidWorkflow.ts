import { createWorkflow } from '@mastra/core/workflows';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { AgentContext, DraftBundle, ParsedDocument, ProductMatch, RequirementItem, ReviewFinding } from '../shared/types';
import { requirementAnalysisStep } from './steps/requirementAnalysis';
import { productIndexingStep } from './steps/productIndexing';
import { productMatchingStep } from './steps/productMatching';
import { draftGenerationStep } from './steps/draftGeneration';
import { aiReviewStep } from './steps/aiReview';
import { extractRequirements } from '../agents/requirementAnalyst';
import { indexProductKnowledge } from '../agents/productKnowledge';
import { matchProducts } from '../agents/productMatcher';
import { generateDrafts } from '../agents/draftWriters';
import { reviewDrafts } from '../agents/reviewAgent';
import { safeJson } from '../shared/security';
import type { WorkflowResult } from '../shared/types';
import type { createVectorStore } from '../services/vectorStore';

type VectorStore = ReturnType<typeof createVectorStore>;

const isEvalEnabled = () => process.env.ENABLE_EVALUATION === 'true';

function recordEval(
  evals: Array<{ category: string; mode: string; input: unknown; output: unknown }>,
  category: string,
  input: unknown,
  output: unknown,
) {
  if (!isEvalEnabled()) return;
  const mode = process.env.OPENAI_COMPAT_API_KEY ? 'llm' : 'rule';
  evals.push({ category, mode, input, output });
}

export const bidWorkflow = createWorkflow({
  id: 'solution-orch-bid-workflow',
  inputSchema: z.object({
    projectId: z.string(),
    documents: z.array(z.any()),
  }),
  outputSchema: z.object({
    projectId: z.string(),
    requirements: z.array(z.any()),
    knowledgeChunks: z.array(z.any()),
    matches: z.array(z.any()),
    drafts: z.any(),
    reviewFindings: z.array(z.any()),
    completedAt: z.string(),
  }),
})
  .then(requirementAnalysisStep)
  .then(productIndexingStep)
  .then(productMatchingStep)
  .then(draftGenerationStep)
  .then(aiReviewStep)
  .commit();

export async function runBidWorkflow(input: {
  projectId: string;
  documents: Array<{ id?: string; kind: string; fileName: string; text: string; metadata?: Record<string, unknown> }>;
}): Promise<WorkflowResult> {
  const run = await bidWorkflow.createRun();
  const result = await run.start({ inputData: input });
  const stepResult = 'steps' in result ? result.steps['ai-review'] : undefined;
  const output = stepResult && 'output' in stepResult
    ? (stepResult as { output: Record<string, unknown> }).output
    : undefined;

  return safeJson({
    projectId: input.projectId,
    requirements: (output?.requirements ?? []) as RequirementItem[],
    knowledgeChunks: (output?.knowledgeChunks ?? []) as unknown as [],
    matches: (output?.matches ?? []) as ProductMatch[],
    drafts: (output?.drafts ?? { solution: null, bid: null }) as DraftBundle,
    reviewFindings: (output?.reviewFindings ?? []) as ReviewFinding[],
    completedAt: (output?.completedAt ?? new Date().toISOString()) as string,
  });
}

const WORKFLOW_STEPS = [
  { id: 'requirement-analysis', label: '需求分析' },
  { id: 'product-knowledge-indexing', label: '产品知识索引' },
  { id: 'product-matching', label: '产品匹配' },
  { id: 'draft-generation', label: '草稿生成' },
  { id: 'ai-review', label: 'AI 审核' },
] as const;

export { WORKFLOW_STEPS };

export type StepProgress = {
  stepId: string;
  label: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  error?: string;
};

export type WorkflowRunOptions = {
  vectorStore?: VectorStore;
  getPreviousRunContext?: () => { requirements: number; matches: Record<string, number>; findings: number; lastRunAt: string | null } | null;
};

export async function runBidWorkflowWithProgress(
  input: {
    projectId: string;
    documents: Array<{ id?: string; kind: string; fileName: string; text: string; metadata?: Record<string, unknown> }>;
  },
  onProgress: (progress: StepProgress) => void,
  opts?: WorkflowRunOptions,
): Promise<{ result: WorkflowResult; evalSnapshots: Array<{ category: string; mode: string; input: unknown; output: unknown }> }> {
  const { documents } = input;
  const ctx: Record<string, unknown> = {};
  const evalSnapshots: Array<{ category: string; mode: string; input: unknown; output: unknown }> = [];
  const runId = randomUUID();

  // Load previous run context for agent awareness
  const previousRun = opts?.getPreviousRunContext?.() ?? null;

  const pending = (stepId: string) => WORKFLOW_STEPS.find((s) => s.id === stepId);
  const emit = (stepId: string, status: StepProgress['status'], error?: string) => {
    const step = pending(stepId);
    if (step) onProgress({ stepId, label: step.label, status, error });
  };

  const docs = documents as unknown as ParsedDocument[];

  for (const step of WORKFLOW_STEPS) {
    emit(step.id, 'running');
    try {
      switch (step.id) {
        case 'requirement-analysis': {
          ctx.requirements = await extractRequirements(docs);
          recordEval(evalSnapshots, 'requirements', { documents: docs.map((d) => d.fileName) }, ctx.requirements);
          break;
        }
        case 'product-knowledge-indexing': {
          ctx.knowledgeChunks = await indexProductKnowledge(docs, opts?.vectorStore);
          recordEval(evalSnapshots, 'product-knowledge', { documents: docs.map((d) => d.fileName) }, ctx.knowledgeChunks);
          break;
        }
        case 'product-matching': {
          const matches = await matchProducts(
            ctx.requirements as RequirementItem[],
            ctx.knowledgeChunks as [],
            opts?.vectorStore,
          );
          // Build shared context for subsequent agents
          const matchedCount = matches.filter((m) => m.status === 'matched').length;
          const partialCount = matches.filter((m) => m.status === 'partial').length;
          const gapCount = matches.filter((m) => m.status === 'gap').length;
          ctx.matches = matches;
          ctx.metrics = {
            requirementsCount: (ctx.requirements as RequirementItem[]).length,
            matchedCount,
            partialCount,
            gapCount,
            coveragePercent: Math.round((matchedCount / Math.max(1, matches.length)) * 100),
          };
          recordEval(evalSnapshots, 'matching', {
            requirements: (ctx.requirements as RequirementItem[]).map((r) => r.title),
            knowledgeChunks: (ctx.knowledgeChunks as []).length,
            previousRun,
          }, ctx.matches);
          break;
        }
        case 'draft-generation': {
          ctx.drafts = await generateDrafts(
            ctx.requirements as RequirementItem[],
            ctx.matches as ProductMatch[]
          );
          recordEval(evalSnapshots, 'draft', {
            requirements: (ctx.requirements as RequirementItem[]).length,
            matches: (ctx.matches as ProductMatch[]).length,
            metrics: ctx.metrics,
            previousRun,
          }, ctx.drafts);
          break;
        }
        case 'ai-review': {
          ctx.reviewFindings = await reviewDrafts(
            ctx.drafts as DraftBundle,
            ctx.requirements as RequirementItem[],
            ctx.matches as ProductMatch[]
          );
          recordEval(evalSnapshots, 'review', {
            drafts: ctx.drafts,
            requirements: (ctx.requirements as RequirementItem[]).length,
            metrics: ctx.metrics,
            previousRun,
          }, ctx.reviewFindings);
          break;
        }
      }
      emit(step.id, 'success');
    } catch (error) {
      emit(step.id, 'failed', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  const result = safeJson({
    projectId: input.projectId,
    requirements: (ctx.requirements ?? []) as RequirementItem[],
    knowledgeChunks: (ctx.knowledgeChunks ?? []) as unknown as [],
    matches: (ctx.matches ?? []) as ProductMatch[],
    drafts: (ctx.drafts ?? { solution: null, bid: null }) as DraftBundle,
    reviewFindings: (ctx.reviewFindings ?? []) as ReviewFinding[],
    completedAt: new Date().toISOString(),
  });

  return { result, evalSnapshots };
}
