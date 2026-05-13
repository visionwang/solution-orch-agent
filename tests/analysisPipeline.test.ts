import { describe, expect, it } from 'vitest';
import { extractRequirements } from '../src/agents/requirementAnalyst';
import { indexProductKnowledge } from '../src/agents/productKnowledge';
import { matchProducts } from '../src/agents/productMatcher';
import { generateDrafts } from '../src/agents/draftWriters';
import { reviewDrafts } from '../src/agents/reviewAgent';

describe('analysis pipeline agents', () => {
  it('extracts requirements with source references', async () => {
    const requirements = await extractRequirements([
      {
        id: 'doc-1',
        kind: 'requirement',
        fileName: '需求说明.txt',
        text: '系统需要支持统一登录。必须支持审计日志。'
      }
    ]);

    expect(requirements).toHaveLength(2);
    expect(requirements[0]).toMatchObject({
      title: expect.stringContaining('统一登录'),
      priority: 'must',
      sourceDocumentId: 'doc-1'
    });
  });

  it('matches requirements to product knowledge and marks gaps', async () => {
    const requirements = [
      {
        id: 'req-1',
        title: '统一登录',
        description: '系统需要支持统一登录',
        priority: 'must' as const,
        sourceDocumentId: 'doc-1',
        sourceExcerpt: '系统需要支持统一登录'
      },
      {
        id: 'req-2',
        title: '离线巡检',
        description: '系统需要支持离线巡检',
        priority: 'should' as const,
        sourceDocumentId: 'doc-1',
        sourceExcerpt: '系统需要支持离线巡检'
      }
    ];
    const chunks = await indexProductKnowledge([
      {
        id: 'doc-2',
        kind: 'product',
        fileName: '产品说明.txt',
        text: '平台提供统一登录、权限控制和审计日志能力。'
      }
    ]);

    const matches = await matchProducts(requirements, chunks);

    expect(matches.find((item) => item.requirementId === 'req-1')?.status).toBe('matched');
    expect(matches.find((item) => item.requirementId === 'req-2')?.status).toBe('gap');
  });

  it('generates grounded drafts and review findings', async () => {
    const requirements = [
      {
        id: 'req-1',
        title: '统一登录',
        description: '系统需要支持统一登录',
        priority: 'must' as const,
        sourceDocumentId: 'doc-1',
        sourceExcerpt: '系统需要支持统一登录'
      }
    ];
    const matches = [
      {
        id: 'match-1',
        requirementId: 'req-1',
        status: 'matched' as const,
        score: 0.86,
        rationale: '产品资料明确提到统一登录',
        evidence: ['平台提供统一登录能力']
      }
    ];

    const drafts = await generateDrafts(requirements, matches);
    const findings = await reviewDrafts(drafts, requirements, matches);

    expect(drafts.solution.content).toContain('统一登录');
    expect(drafts.bid.content).toContain('需求响应');
    expect(findings.some((item) => item.type === 'coverage')).toBe(true);
  });
});

