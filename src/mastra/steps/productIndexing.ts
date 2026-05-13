import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { indexProductKnowledge } from '../../agents/productKnowledge';

export const productIndexingStep = createStep({
  id: 'product-knowledge-indexing',
  inputSchema: z.object({
    documents: z.array(z.any()),
    requirements: z.array(z.any()),
  }),
  outputSchema: z.object({
    documents: z.array(z.any()),
    requirements: z.array(z.any()),
    knowledgeChunks: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const knowledgeChunks = await indexProductKnowledge(inputData.documents);
    return {
      documents: inputData.documents,
      requirements: inputData.requirements,
      knowledgeChunks,
    };
  },
});
