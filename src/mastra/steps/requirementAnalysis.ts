import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { extractRequirements } from '../../agents/requirementAnalyst';

export const requirementAnalysisStep = createStep({
  id: 'requirement-analysis',
  inputSchema: z.object({
    projectId: z.string(),
    documents: z.array(z.any()),
  }),
  outputSchema: z.object({
    documents: z.array(z.any()),
    requirements: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const requirements = await extractRequirements(inputData.documents);
    return {
      documents: inputData.documents,
      requirements,
    };
  },
});
