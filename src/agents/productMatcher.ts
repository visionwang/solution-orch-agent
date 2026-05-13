import { randomUUID } from 'node:crypto';
import type { KnowledgeChunk, ProductMatch, RequirementItem, MatchStatus } from '../shared/types';
import { callLlmJson, isLlmAvailable } from '../services/llm';
import { getProductMatcher } from '../services/agentRuntime';
import { extractKeywords } from './productKnowledge';
import type { createVectorStore } from '../services/vectorStore';

type VectorStore = ReturnType<typeof createVectorStore>;

export async function matchProducts(
  requirements: RequirementItem[],
  chunks: KnowledgeChunk[],
  vectorStore?: VectorStore,
): Promise<ProductMatch[]> {
  if (requirements.length === 0) {
    return [];
  }

  if (isLlmAvailable()) {
    return matchProductsViaLlm(requirements, chunks, vectorStore);
  }

  return matchProductsRuleBased(requirements, chunks);
}

async function matchProductsViaLlm(
  requirements: RequirementItem[],
  chunks: KnowledgeChunk[],
  vectorStore?: VectorStore,
): Promise<ProductMatch[]> {
  const results: ProductMatch[] = [];

  const batchSize = 5;
  for (let i = 0; i < requirements.length; i += batchSize) {
    const batch = requirements.slice(i, i + batchSize);

    // Use vector search if available, otherwise use all chunks
    let relevantChunks = chunks;
    if (vectorStore?.isAvailable()) {
      const topK = 10;
      relevantChunks = [];
      for (const req of batch) {
        const hits = await vectorStore.searchSimilar(`${req.title} ${req.description}`, topK).catch(() => []);
        for (const hit of hits) {
          if (!relevantChunks.find((c) => c.content === hit.chunk.content)) {
            relevantChunks.push({ content: hit.chunk.content } as KnowledgeChunk);
          }
        }
      }
      if (relevantChunks.length === 0) relevantChunks = chunks.slice(0, topK);
    }

    const knowledgeText = relevantChunks
      .map((c, idx) => `[知识块 ${idx}]\n${c.content}`)
      .join('\n\n');

    const requirementsText = batch
      .map((r, idx) => `[需求 ${idx}] title: ${r.title}\ndescription: ${r.description}\npriority: ${r.priority}`)
      .join('\n\n');

    const prompt = `你是一个产品-需求匹配专家。请判断以下产品知识块与每条需求的匹配程度。

产品知识块：
${knowledgeText}

需求列表：
${requirementsText}

对每条需求输出匹配结果：
- status: "matched"（完全满足）/ "partial"（部分满足）/ "gap"（不能满足或没有证据）
- score: 0-1 之间的分数，matched 应 >=0.6，partial 应 >=0.2
- rationale: 简短说明匹配或不匹配的原因
- evidence: 相关的知识块内容片段列表（最多3条），如果没有匹配证据则为空数组

返回 JSON 数组，格式：[{ "requirementIndex": 0, "status": "matched", "score": 0.85, "rationale": "...", "evidence": ["..."] }]

请只返回 JSON 数组。`;

    const agent = getProductMatcher();
    const matches = await callLlmJson<Array<{
      requirementIndex: number;
      status: string;
      score: number;
      rationale: string;
      evidence: string[];
    }>>(prompt, undefined, agent ?? undefined);

    for (const m of matches) {
      const req = batch[m.requirementIndex];
      if (!req) continue;
      results.push({
        id: randomUUID(),
        requirementId: req.id,
        status: normalizeMatchStatus(m.status),
        score: Math.round(Math.max(0, Math.min(1, m.score)) * 100) / 100,
        rationale: m.rationale,
        evidence: m.evidence.slice(0, 3),
      });
    }
  }

  return results;
}

function normalizeMatchStatus(value: string): MatchStatus {
  if (/partial/i.test(value)) return 'partial';
  if (/gap|miss|no/i.test(value)) return 'gap';
  return 'matched';
}

function matchProductsRuleBased(requirements: RequirementItem[], chunks: KnowledgeChunk[]): ProductMatch[] {
  return requirements.map((requirement) => {
    const requirementKeywords = extractKeywords(`${requirement.title} ${requirement.description}`);
    const ranked = chunks
      .map((chunk) => ({
        chunk,
        score: scoreChunk(requirementKeywords, chunk)
      }))
      .sort((left, right) => right.score - left.score);
    const best = ranked[0];

    if (!best || best.score < 0.18) {
      return {
        id: randomUUID(),
        requirementId: requirement.id,
        status: 'gap',
        score: 0,
        rationale: '未在产品资料中找到足够证据，需要人工补充或确认。',
        evidence: []
      };
    }

    const status = best.score >= 0.5 ? 'matched' : 'partial';

    return {
      id: randomUUID(),
      requirementId: requirement.id,
      status,
      score: Number(best.score.toFixed(2)),
      rationale: status === 'matched' ? '产品资料与需求关键词高度一致。' : '产品资料存在相关能力，但证据不完整。',
      evidence: ranked.filter((item) => item.score > 0).slice(0, 3).map((item) => item.chunk.content)
    };
  });
}

function scoreChunk(requirementKeywords: string[], chunk: KnowledgeChunk): number {
  if (requirementKeywords.length === 0) {
    return 0;
  }

  const content = chunk.content;
  const hits = requirementKeywords.filter((keyword) => content.includes(keyword));
  const overlap = hits.length / requirementKeywords.length;
  const exactBoost = requirementKeywords.some((keyword) => chunk.keywords.includes(keyword)) ? 0.24 : 0;

  return Math.min(1, overlap + exactBoost);
}
