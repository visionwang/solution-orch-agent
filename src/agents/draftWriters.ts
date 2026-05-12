import { randomUUID } from 'node:crypto';
import type { DraftArtifact, DraftBundle, ProductMatch, RequirementItem } from '../shared/types';

export function generateDrafts(requirements: RequirementItem[], matches: ProductMatch[]): DraftBundle {
  const updatedAt = new Date().toISOString();

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

