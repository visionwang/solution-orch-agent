import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { reviewDrafts } from '../../agents/reviewAgent';

export const aiReviewStep = createStep({
  id: 'ai-review',
  inputSchema: z.object({
    documents: z.array(z.any()),
    requirements: z.array(z.any()),
    knowledgeChunks: z.array(z.any()),
    matches: z.array(z.any()),
    drafts: z.any(),
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
  execute: async ({ inputData }) => {
    const reviewFindings = await reviewDrafts(inputData.drafts, inputData.requirements, inputData.matches);
    return {
      projectId: '',
      requirements: inputData.requirements,
      knowledgeChunks: inputData.knowledgeChunks,
      matches: inputData.matches,
      drafts: inputData.drafts,
      reviewFindings,
      completedAt: new Date().toISOString(),
    };
  },
});
