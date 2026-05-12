import { randomUUID } from 'node:crypto';
import type { KnowledgeChunk, ProductMatch, RequirementItem } from '../shared/types';
import { extractKeywords } from './productKnowledge';

export function matchProducts(requirements: RequirementItem[], chunks: KnowledgeChunk[]): ProductMatch[] {
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
