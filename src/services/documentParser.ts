import { basename, extname } from 'node:path';
import type { DocumentKind } from '../shared/types';
import { redactSensitiveText } from '../shared/security';

export interface DocumentParseInput {
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  kind?: DocumentKind;
}

export interface DocumentParseResult {
  text: string;
  metadata: {
    fileName: string;
    mimeType: string;
    size: number;
    parser: string;
  };
}

export async function parsePlainTextDocument(input: DocumentParseInput): Promise<DocumentParseResult> {
  return {
    text: normalizeExtractedText(input.buffer.toString('utf8')),
    metadata: safeMetadata(input, 'plain-text')
  };
}

export async function parseDocumentAsset(input: DocumentParseInput): Promise<DocumentParseResult> {
  const extension = extname(input.fileName).toLowerCase();

  if (extension === '.docx') {
    return parseDocx(input);
  }

  if (extension === '.xlsx' || extension === '.xls') {
    return parseWorkbook(input);
  }

  if (extension === '.pdf') {
    return parsePdf(input);
  }

  return parsePlainTextDocument(input);
}

export function normalizeExtractedText(text: string): string {
  return redactSensitiveText(text)
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

async function parseDocx(input: DocumentParseInput): Promise<DocumentParseResult> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer: input.buffer });

  return {
    text: normalizeExtractedText(result.value),
    metadata: safeMetadata(input, 'mammoth')
  };
}

async function parseWorkbook(input: DocumentParseInput): Promise<DocumentParseResult> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(input.buffer, { type: 'buffer' });
  const text = workbook.SheetNames.flatMap((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }).map((row) =>
      Object.values(row).filter(Boolean).join(' ')
    );
  }).join('\n');

  return {
    text: normalizeExtractedText(text),
    metadata: safeMetadata(input, 'xlsx')
  };
}

async function parsePdf(input: DocumentParseInput): Promise<DocumentParseResult> {
  const pdfParse = (await import('pdf-parse')).default;
  const result = await pdfParse(input.buffer);

  return {
    text: normalizeExtractedText(result.text),
    metadata: safeMetadata(input, 'pdf-parse')
  };
}

function safeMetadata(input: DocumentParseInput, parser: string): DocumentParseResult['metadata'] {
  return {
    fileName: basename(input.fileName),
    mimeType: input.mimeType,
    size: input.buffer.byteLength,
    parser
  };
}
