import { describe, expect, it } from 'vitest';
import { WORKFLOW_STEPS } from '../src/mastra/bidWorkflow';

describe('Workflow streaming', () => {
  it('WORKFLOW_STEPS contains all expected steps in order', () => {
    expect(WORKFLOW_STEPS).toHaveLength(5);
    expect(WORKFLOW_STEPS[0].id).toBe('requirement-analysis');
    expect(WORKFLOW_STEPS[1].id).toBe('product-knowledge-indexing');
    expect(WORKFLOW_STEPS[2].id).toBe('product-matching');
    expect(WORKFLOW_STEPS[3].id).toBe('draft-generation');
    expect(WORKFLOW_STEPS[4].id).toBe('ai-review');
  });

  it('each step has id and label', () => {
    for (const step of WORKFLOW_STEPS) {
      expect(step.id).toBeTruthy();
      expect(step.label).toBeTruthy();
    }
  });
});
