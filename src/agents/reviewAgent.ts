import { randomUUID } from 'node:crypto';
import type { DraftBundle, ProductMatch, RequirementItem, ReviewFinding } from '../shared/types';

export function reviewDrafts(
  drafts: DraftBundle,
  requirements: RequirementItem[],
  matches: ProductMatch[]
): ReviewFinding[] {
  const findings: ReviewFinding[] = [
    {
      id: randomUUID(),
      type: 'coverage',
      severity: 'info',
      title: '需求覆盖检查完成',
      detail: `草稿覆盖 ${requirements.length} 条结构化需求。`,
      target: drafts.solution.id
    }
  ];

  for (const requirement of requirements) {
    const match = matches.find((item) => item.requirementId === requirement.id);

    if (!match || match.status === 'gap') {
      findings.push({
        id: randomUUID(),
        type: 'coverage',
        severity: requirement.priority === 'must' ? 'critical' : 'warning',
        title: `缺少产品依据：${requirement.title}`,
        detail: '该需求未匹配到产品资料证据，正式投标前不能直接承诺。',
        target: requirement.id
      });
    }

    if (match?.status === 'partial') {
      findings.push({
        id: randomUUID(),
        type: 'evidence',
        severity: 'warning',
        title: `证据不足：${requirement.title}`,
        detail: '产品资料存在相关描述，但不能完整覆盖需求，需要补充说明或澄清。',
        target: requirement.id
      });
    }
  }

  if (!drafts.bid.content.includes('需求响应')) {
    findings.push({
      id: randomUUID(),
      type: 'format',
      severity: 'warning',
      title: '投标材料缺少需求响应章节',
      detail: '建议补充结构化需求响应表，便于审核和评分点对齐。',
      target: drafts.bid.id
    });
  }

  return findings;
}

