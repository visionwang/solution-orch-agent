import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock agentRuntime to return null so tests use callLlmJson path (not Mastra Agent internals)
vi.mock('../src/services/agentRuntime', () => ({
  getRequirementAnalyst: () => null,
  getProductMatcher: () => null,
  getDraftWriter: () => null,
  getReviewAgent: () => null,
}));

describe('Agents with LLM enabled', () => {
  beforeEach(() => {
    process.env.OPENAI_COMPAT_API_KEY = 'sk-test-key';
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENAI_COMPAT_API_KEY;
  });

  it('extractRequirements calls LLM when available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify([
              { title: '统一登录', description: '系统需要支持统一登录', priority: 'must', sourceExcerpt: '必须支持统一登录' },
              { title: '审计日志', description: '平台需要提供审计日志', priority: 'should', sourceExcerpt: '需要提供审计日志' },
            ])
          }
        }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { extractRequirements } = await import('../src/agents/requirementAnalyst');
    const result = await extractRequirements([
      { id: 'doc-1', kind: 'requirement', fileName: '需求.txt', text: '必须支持统一登录。需要提供审计日志。' }
    ]);

    expect(result).toHaveLength(2);
    expect(result[0].title).toBe('统一登录');
    expect(result[0].priority).toBe('must');
  });

  it('indexProductKnowledge calls LLM when available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify([
              { content: '平台提供统一登录和权限控制', keywords: ['统一登录', '权限控制'] },
            ])
          }
        }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { indexProductKnowledge } = await import('../src/agents/productKnowledge');
    const result = await indexProductKnowledge([
      { id: 'doc-2', kind: 'product', fileName: '产品.txt', text: '平台提供统一登录和权限控制' }
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].keywords).toContain('统一登录');
  });

  it('matchProducts calls LLM when available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify([
              { requirementIndex: 0, status: 'matched', score: 0.85, rationale: '产品支持', evidence: ['平台提供统一登录'] },
            ])
          }
        }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { matchProducts } = await import('../src/agents/productMatcher');
    const result = await matchProducts(
      [{ id: 'req-1', title: '统一登录', description: '需要统一登录', priority: 'must', sourceDocumentId: 'doc-1', sourceExcerpt: '需要统一登录' }],
      [{ id: 'chunk-1', documentId: 'doc-2', fileName: '产品.txt', content: '平台提供统一登录', keywords: ['统一登录'] }]
    );

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe('matched');
    expect(result[0].score).toBeGreaterThan(0.5);
  });

  it('generateDrafts calls LLM when available', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      callCount++;
      const content = callCount === 1
        ? '# 解决方案草稿\n\n测试解决方案内容。'
        : '# 投标材料草稿\n\n测试投标材料内容。';
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          choices: [{ message: { content } }]
        })
      });
    });
    vi.stubGlobal('fetch', mockFetch);

    const { generateDrafts } = await import('../src/agents/draftWriters');
    const result = await generateDrafts(
      [{ id: 'req-1', title: '统一登录', description: '需要统一登录', priority: 'must', sourceDocumentId: 'doc-1', sourceExcerpt: '需要统一登录' }],
      [{ id: 'match-1', requirementId: 'req-1', status: 'matched', score: 0.85, rationale: '匹配', evidence: ['证据'] }]
    );

    expect(result.solution.content).toContain('解决方案');
    expect(result.bid.content).toContain('投标材料');
  });

  it('reviewDrafts calls LLM when available', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{
          message: {
            content: JSON.stringify([
              { type: 'coverage', severity: 'warning', title: '需求覆盖不全', detail: '部分需求未响应' },
            ])
          }
        }]
      })
    });
    vi.stubGlobal('fetch', mockFetch);

    const { reviewDrafts } = await import('../src/agents/reviewAgent');
    const result = await reviewDrafts(
      {
        solution: { id: 'draft-s', type: 'solution', title: '方案', content: '# 方案', updatedAt: '' },
        bid: { id: 'draft-b', type: 'bid', title: '投标', content: '# 投标', updatedAt: '' },
      },
      [{ id: 'req-1', title: '统一登录', description: '需要统一登录', priority: 'must', sourceDocumentId: 'doc-1', sourceExcerpt: '需要统一登录' }],
      [{ id: 'match-1', requirementId: 'req-1', status: 'gap', score: 0, rationale: '无匹配', evidence: [] }]
    );

    expect(result.length).toBeGreaterThan(0);
  });
});
