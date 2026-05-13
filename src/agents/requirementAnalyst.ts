import { randomUUID } from 'node:crypto';
import type { ParsedDocument, RequirementItem, RequirementPriority } from '../shared/types';
import { callLlmJson, isLlmAvailable } from '../services/llm';
import { getRequirementAnalyst } from '../services/agentRuntime';

const SENTENCE_SPLIT = /[。！？!?；;\n]/;
const REQUIREMENT_HINTS = ['必须', '需要', '应', '支持', '实现', '具备', '提供', '满足', '要求'];

export async function extractRequirements(documents: ParsedDocument[]): Promise<RequirementItem[]> {
  const targetDocs = documents.filter(
    (document) => document.kind === 'requirement' || document.kind === 'reference'
  );

  if (targetDocs.length === 0) {
    return [];
  }

  if (isLlmAvailable()) {
    return extractRequirementsViaLlm(targetDocs);
  }

  return extractRequirementsRuleBased(targetDocs);
}

async function extractRequirementsViaLlm(docs: ParsedDocument[]): Promise<RequirementItem[]> {
  const combinedText = docs.map((d) => `[文件：${d.fileName}]\n${d.text}`).join('\n\n---\n\n');

  const prompt = `你是一个招标需求分析专家。请从以下需求文档和参考资料中提取结构化需求。

要求：
1. 提取所有明确的功能性需求和约束条件
2. 每个需求包含：title（简洁标题）、description（完整描述）、priority（must/should/nice）
3. 优先级规则：含"必须""强制""需要""要求"等重要表述 → must；含"建议""可选""宜"→ nice；其余 → should
4. 每个需求包含 sourceExcerpt（原文片段）
5. 返回 JSON 数组，格式：[{ "title": "...", "description": "...", "priority": "must", "sourceExcerpt": "..." }]

文档内容：
${combinedText}

请只返回 JSON 数组，不要包含其他文字。`;

  const agent = getRequirementAnalyst();
  const items = await callLlmJson<Array<{ title: string; description: string; priority: string; sourceExcerpt: string }>>(prompt, undefined, agent ?? undefined);

  return items.slice(0, 80).map((item) => ({
    id: randomUUID(),
    title: item.title,
    description: item.description,
    priority: normalizePriority(item.priority),
    sourceDocumentId: '',
    sourceExcerpt: item.sourceExcerpt,
  }));
}

function normalizePriority(value: string): RequirementPriority {
  if (/must/i.test(value)) return 'must';
  if (/nice/i.test(value)) return 'nice';
  return 'should';
}

function extractRequirementsRuleBased(docs: ParsedDocument[]): RequirementItem[] {
  return docs
    .flatMap((document) =>
      splitRequirementSentences(document.text).map((sentence) => toRequirement(document, sentence))
    )
    .filter(Boolean)
    .slice(0, 80) as RequirementItem[];
}

function splitRequirementSentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
    .filter((item) => REQUIREMENT_HINTS.some((hint) => item.includes(hint)));
}

function toRequirement(document: ParsedDocument, sentence: string): RequirementItem | null {
  const title = compactTitle(sentence);

  if (!title) {
    return null;
  }

  return {
    id: randomUUID(),
    title,
    description: sentence,
    priority: inferPriority(sentence),
    sourceDocumentId: document.id ?? document.fileName,
    sourceExcerpt: sentence
  };
}

function compactTitle(sentence: string): string {
  return sentence
    .replace(/^(系统|平台|产品|项目|投标人|供应商)?(必须|需要|应当|应|需|要求|支持|实现|具备|提供)/, '')
    .replace(/[，,].*$/, '')
    .trim()
    .slice(0, 28);
}

function inferPriority(sentence: string): RequirementPriority {
  if (/(必须|强制|不得|应当|必需|要求|需要)/.test(sentence)) {
    return 'must';
  }

  if (/(建议|可选|宜|优先)/.test(sentence)) {
    return 'nice';
  }

  return 'should';
}
