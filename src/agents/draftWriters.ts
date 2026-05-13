import { randomUUID } from 'node:crypto';
import type { DraftArtifact, DraftBundle, ProductMatch, RequirementItem } from '../shared/types';
import { callLlm, isLlmAvailable } from '../services/llm';
import { getDraftWriter } from '../services/agentRuntime';

export async function generateDrafts(requirements: RequirementItem[], matches: ProductMatch[]): Promise<DraftBundle> {
  const updatedAt = new Date().toISOString();

  if (isLlmAvailable()) {
    return generateDraftsViaLlm(requirements, matches, updatedAt);
  }

  return generateDraftsRuleBased(requirements, matches, updatedAt);
}

async function generateDraftsViaLlm(
  requirements: RequirementItem[],
  matches: ProductMatch[],
  updatedAt: string
): Promise<DraftBundle> {
  const matchTable = matches
    .map((m) => {
      const r = requirements.find((req) => req.id === m.requirementId);
      return `[需求] ${r?.title ?? 'unknown'} (${r?.priority ?? '?'})
  匹配状态：${m.status} | 评分：${m.score}
  依据：${m.rationale}
  证据：${m.evidence.join('; ') || '无'}`;
    })
    .join('\n');

  const solutionPrompt = `你是一个解决方案专家。请根据以下需求清单和产品匹配结果，撰写一份专业的解决方案草稿（Markdown 格式）。

## 要求
- 标题用 # 和 ##
- 包含：项目理解、需求响应与产品能力匹配（逐条说明）、风险与待确认事项
- 语言专业、逻辑清晰、面向投标场景
- 对 matched 的需求给出正面响应，对 partial 的给出补充方案，对 gap 的标记需澄清

## 需求及匹配情况
${matchTable}

请直接输出 Markdown 内容。`;

  const bidPrompt = `你是一个投标材料撰写专家。请根据以下需求清单和产品匹配结果，撰写一份专业的投标材料草稿（Markdown 格式）。

## 要求
- 标题用 # 和 ##
- 包含：需求响应表（Markdown 表格格式：需求项｜优先级｜响应｜说明）、技术方案摘要、交付与风险声明
- 语言专业、面向评审场景

## 需求及匹配情况
${matchTable}

请直接输出 Markdown 内容。`;

  const agent = getDraftWriter();
  const [solutionContent, bidContent] = await Promise.all([
    callLlm(solutionPrompt, undefined, agent ?? undefined),
    callLlm(bidPrompt, undefined, agent ?? undefined),
  ]);

  return {
    solution: {
      id: randomUUID(),
      type: 'solution',
      title: '解决方案草稿',
      content: solutionContent.trim(),
      updatedAt,
    },
    bid: {
      id: randomUUID(),
      type: 'bid',
      title: '投标材料草稿',
      content: bidContent.trim(),
      updatedAt,
    },
  };
}

function generateDraftsRuleBased(
  requirements: RequirementItem[],
  matches: ProductMatch[],
  updatedAt: string
): DraftBundle {
  return {
    solution: {
      id: randomUUID(),
      type: 'solution',
      title: '解决方案草稿',
      content: buildSolutionDraft(requirements, matches),
      updatedAt
    },
    bid: {
      id: randomUUID(),
      type: 'bid',
      title: '投标材料草稿',
      content: buildBidDraft(requirements, matches),
      updatedAt
    }
  };
}

function buildSolutionDraft(requirements: RequirementItem[], matches: ProductMatch[]): string {
  const rows = requirements.map((requirement) => {
    const match = matches.find((item) => item.requirementId === requirement.id);
    const evidence = match?.evidence[0] ? `\n  - 引用依据：${match.evidence[0]}` : '\n  - 引用依据：暂无，需要人工补充';
    return `- ${requirement.title}\n  - 需求描述：${requirement.description}\n  - 匹配状态：${match?.status ?? 'gap'}，评分：${match?.score ?? 0}\n  - 响应思路：${match?.rationale ?? '需要补充产品能力说明。'}${evidence}`;
  });

  return [
    '# 解决方案草稿',
    '',
    '## 1. 项目理解',
    `本方案基于已解析资料识别出 ${requirements.length} 条需求，优先覆盖强制性需求并标记产品能力缺口。`,
    '',
    '## 2. 需求响应与产品能力匹配',
    rows.join('\n'),
    '',
    '## 3. 风险与待确认事项',
    '- 对标记为 gap 或 partial 的需求，需要售前、产品或交付团队确认可承诺范围。',
    '- 所有引用依据均来自上传产品资料，正式投标前需复核原文。'
  ].join('\n');
}

function buildBidDraft(requirements: RequirementItem[], matches: ProductMatch[]): string {
  const responseTable = requirements.map((requirement) => {
    const match = matches.find((item) => item.requirementId === requirement.id);
    const response = match?.status === 'matched' ? '满足' : match?.status === 'partial' ? '部分满足' : '需澄清';
    return `| ${requirement.title} | ${requirement.priority} | ${response} | ${match?.rationale ?? '暂无依据'} |`;
  });

  return [
    '# 投标材料草稿',
    '',
    '## 1. 需求响应表',
    '| 需求项 | 优先级 | 响应 | 说明 |',
    '| --- | --- | --- | --- |',
    ...responseTable,
    '',
    '## 2. 技术方案摘要',
    '围绕需求清单和产品能力证据，建议采用标准产品能力优先、差异能力专项澄清的投标策略。',
    '',
    '## 3. 交付与风险声明',
    '正式提交前，应对所有“部分满足”和“需澄清”条目补充商务或产品确认意见。'
  ].join('\n');
}

