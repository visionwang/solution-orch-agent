import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { matchProducts } from '../../agents/productMatcher';

export const productMatchingStep = createStep({
  id: 'product-matching',
  inputSchema: z.object({
    documents: z.array(z.any()),
    requirements: z.array(z.any()),
    knowledgeChunks: z.array(z.any()),
  }),
  outputSchema: z.object({
    documents: z.array(z.any()),
    requirements: z.array(z.any()),
    knowledgeChunks: z.array(z.any()),
    matches: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const matches = await matchProducts(inputData.requirements, inputData.knowledgeChunks);
    return {
      documents: inputData.documents,
      requirements: inputData.requirements,
      knowledgeChunks: inputData.knowledgeChunks,
      matches,
    };
  },
});
