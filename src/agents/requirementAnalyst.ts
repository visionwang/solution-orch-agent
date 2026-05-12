import { randomUUID } from 'node:crypto';
import type { ParsedDocument, RequirementItem, RequirementPriority } from '../shared/types';

const SENTENCE_SPLIT = /[。！？!?；;\n]/;
const REQUIREMENT_HINTS = ['必须', '需要', '应', '支持', '实现', '具备', '提供', '满足', '要求'];

export function extractRequirements(documents: ParsedDocument[]): RequirementItem[] {
  return documents
    .filter((document) => document.kind === 'requirement' || document.kind === 'reference')
    .flatMap((document) => splitRequirementSentences(document.text).map((sentence) => toRequirement(document, sentence)))
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
