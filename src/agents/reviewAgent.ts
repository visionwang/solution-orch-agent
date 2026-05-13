import { randomUUID } from 'node:crypto';
import type { DraftBundle, ProductMatch, RequirementItem, ReviewFinding } from '../shared/types';
import { callLlmJson, isLlmAvailable } from '../services/llm';
import { getReviewAgent } from '../services/agentRuntime';

export async function reviewDrafts(
  drafts: DraftBundle,
  requirements: RequirementItem[],
  matches: ProductMatch[]
): Promise<ReviewFinding[]> {
  if (isLlmAvailable()) {
    return reviewDraftsViaLlm(drafts, requirements, matches);
  }

  return reviewDraftsRuleBased(drafts, requirements, matches);
}

async function reviewDraftsViaLlm(
  drafts: DraftBundle,
  requirements: RequirementItem[],
  matches: ProductMatch[]
): Promise<ReviewFinding[]> {
  const prompt = `你是一个投标方案审核专家。请审核以下解决方案和投标材料草稿，输出审核意见。

## 审核维度
1. coverage — 需求覆盖：检查哪些需求没有被草稿充分响应
2. risk — 风险：识别草稿中可能存在的承诺风险、缺失功能风险
3. evidence — 证据充分性：检查产品能力是否有足够证据支撑
4. format — 格式与结构：检查草稿结构是否完整

## 需求清单
${requirements.map((r) => `- ${r.title} (${r.priority})：${r.description}`).join('\n')}

## 需求-产品匹配情况
${matches.map((m) => {
  const r = requirements.find((req) => req.id === m.requirementId);
  return `- ${r?.title ?? 'unknown'}: status=${m.status}, score=${m.score}, ${m.rationale}`;
}).join('\n')}

## 解决方案草稿内容
${drafts.solution.content.slice(0, 3000)}

## 投标材料草稿内容
${drafts.bid.content.slice(0, 3000)}

返回 JSON 数组，格式：
[{ "type": "coverage|risk|evidence|format", "severity": "info|warning|critical", "title": "简短标题", "detail": "详细描述" }]

请只返回 JSON 数组。`;

  const agent = getReviewAgent();
  const findings = await callLlmJson<Array<{
    type: string;
    severity: string;
    title: string;
    detail: string;
  }>>(prompt, undefined, agent ?? undefined);

  return findings.slice(0, 20).map((f) => ({
    id: randomUUID(),
    type: normalizeReviewType(f.type),
    severity: normalizeSeverity(f.severity),
    title: f.title,
    detail: f.detail,
    target: undefined,
  }));
}

function normalizeReviewType(value: string): ReviewFinding['type'] {
  if (/risk/i.test(value)) return 'risk';
  if (/evidence/i.test(value)) return 'evidence';
  if (/format|struct/i.test(value)) return 'format';
  return 'coverage';
}

function normalizeSeverity(value: string): ReviewFinding['severity'] {
  if (/critical|severe|high/i.test(value)) return 'critical';
  if (/warn/i.test(value)) return 'warning';
  return 'info';
}

function reviewDraftsRuleBased(
  drafts: DraftBundle,
  requirements: RequirementItem[],
  matches: ProductMatch[]
): ReviewFinding[] {
  const findings: ReviewFinding[] = [{
    id: randomUUID(),
    type: 'coverage',
    severity: 'info',
    title: '需求覆盖检查完成',
    detail: `草稿覆盖 ${requirements.length} 条结构化需求。`,
    target: drafts.solution.id
  }];

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

