import { randomUUID } from 'node:crypto';
import type { KnowledgeChunk, ParsedDocument } from '../shared/types';

const KEYWORD_SPLIT = /[\s,，。；;、:：()（）\[\]【】]+/;
const CAPABILITY_PHRASES = [
  '统一登录',
  '审计日志',
  '报表导出',
  '权限控制',
  '离线巡检',
  '产品资料',
  '需求响应',
  '标书导出'
];

export function indexProductKnowledge(documents: ParsedDocument[]): KnowledgeChunk[] {
  return documents
    .filter((document) => document.kind === 'product')
    .flatMap((document) => chunkText(document.text).map((content) => ({
      id: randomUUID(),
      documentId: document.id ?? document.fileName,
      fileName: document.fileName,
      content,
      keywords: extractKeywords(content)
    })));
}

export function extractKeywords(text: string): string[] {
  const phraseHits = CAPABILITY_PHRASES.filter((phrase) => text.includes(phrase));
  const tokens = text
    .split(KEYWORD_SPLIT)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .filter((token) => !/^(系统|平台|产品|支持|提供|实现|能力|需要|必须)$/.test(token));

  return [...new Set([...phraseHits, ...tokens])].slice(0, 20);
}

function chunkText(text: string): string[] {
  const paragraphs = text.split('\n').map((item) => item.trim()).filter(Boolean);

  if (paragraphs.length > 0) {
    return paragraphs.flatMap(splitLongParagraph);
  }

  return splitLongParagraph(text);
}

function splitLongParagraph(paragraph: string): string[] {
  const maxLength = 360;
  const chunks: string[] = [];

  for (let index = 0; index < paragraph.length; index += maxLength) {
    const chunk = paragraph.slice(index, index + maxLength).trim();
    if (chunk) {
      chunks.push(chunk);
    }
  }

  return chunks;
}
