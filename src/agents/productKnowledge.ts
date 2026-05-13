import { randomUUID } from 'node:crypto';
import type { KnowledgeChunk, ParsedDocument } from '../shared/types';
import { callLlmJson, isLlmAvailable } from '../services/llm';
import type { createVectorStore } from '../services/vectorStore';

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

type VectorStore = ReturnType<typeof createVectorStore>;

export async function indexProductKnowledge(
  documents: ParsedDocument[],
  vectorStore?: VectorStore,
): Promise<KnowledgeChunk[]> {
  const productDocs = documents.filter((document) => document.kind === 'product');

  if (productDocs.length === 0) {
    return [];
  }

  if (isLlmAvailable()) {
    const chunks = await indexProductKnowledgeViaLlm(productDocs);
    if (vectorStore?.isAvailable()) {
      await vectorStore.indexChunks(chunks).catch(() => {});
    }
    return chunks;
  }

  return indexProductKnowledgeRuleBased(productDocs);
}

async function indexProductKnowledgeViaLlm(docs: ParsedDocument[]): Promise<KnowledgeChunk[]> {
  const combinedText = docs.map((d) => `[文件：${d.fileName}]\n${d.text}`).join('\n\n---\n\n');

  const prompt = `你是一个产品知识分析专家。请分析以下产品资料，提取产品的能力标签和知识片段。

要求：
1. 将产品资料按能力领域分成多个知识片段
2. 每个片段包含：content（知识片段内容）、keywords（相关能力关键词列表，3-8个）
3. 知识片段应具有语义完整性，不要太碎片化
4. 返回 JSON 数组，格式：[{ "content": "...", "keywords": ["关键词1", "关键词2"] }]

产品资料：
${combinedText}

请只返回 JSON 数组，不要包含其他文字。`;

  const items = await callLlmJson<Array<{ content: string; keywords: string[] }>>(prompt);

  return items.map((item) => ({
    id: randomUUID(),
    documentId: docs[0]?.id ?? docs[0]?.fileName ?? '',
    fileName: docs[0]?.fileName ?? '',
    content: item.content,
    keywords: item.keywords.slice(0, 20),
  }));
}

function indexProductKnowledgeRuleBased(docs: ParsedDocument[]): KnowledgeChunk[] {
  return docs
    .flatMap((document) =>
      chunkText(document.text).map((content) => ({
        id: randomUUID(),
        documentId: document.id ?? document.fileName,
        fileName: document.fileName,
        content,
        keywords: extractKeywords(content),
      }))
    );
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
