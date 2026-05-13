import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { generateDrafts } from '../../agents/draftWriters';

export const draftGenerationStep = createStep({
  id: 'draft-generation',
  inputSchema: z.object({
    documents: z.array(z.any()),
    requirements: z.array(z.any()),
    knowledgeChunks: z.array(z.any()),
    matches: z.array(z.any()),
  }),
  outputSchema: z.object({
    documents: z.array(z.any()),
    requirements: z.array(z.any()),
    knowledgeChunks: z.array(z.any()),
    matches: z.array(z.any()),
    drafts: z.any(),
  }),
  execute: async ({ inputData }) => {
    const drafts = await generateDrafts(inputData.requirements, inputData.matches);
    return {
      documents: inputData.documents,
      requirements: inputData.requirements,
      knowledgeChunks: inputData.knowledgeChunks,
      matches: inputData.matches,
      drafts,
    };
  },
});
