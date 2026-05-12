import { describe, expect, it } from 'vitest';
import { runBidWorkflow } from '../src/mastra/bidWorkflow';

describe('runBidWorkflow', () => {
  it('runs the end-to-end prototype workflow', async () => {
    const result = await runBidWorkflow({
      projectId: 'project-1',
      documents: [
        {
          id: 'doc-1',
          kind: 'requirement',
          fileName: '需求说明.txt',
          text: '系统必须支持统一登录和审计日志。'
        },
        {
          id: 'doc-2',
          kind: 'product',
          fileName: '产品说明.txt',
          text: '平台提供统一登录、权限控制、审计日志和报表导出能力。'
        }
      ]
    });

    expect(result.requirements.length).toBeGreaterThan(0);
    expect(result.matches.some((item) => item.status === 'matched')).toBe(true);
    expect(result.drafts.solution.content).toContain('解决方案');
    expect(result.reviewFindings.length).toBeGreaterThan(0);
  });
});

