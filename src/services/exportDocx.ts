import type { DraftArtifact } from '../shared/types';
import { redactSensitiveText } from '../shared/security';
import type { Paragraph as DocxParagraph } from 'docx';

export async function exportDraftsToDocx(drafts: DraftArtifact[]): Promise<Buffer> {
  const docx = await import('docx');
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = docx;
  const children = drafts.flatMap((draft) => [
    new Paragraph({
      text: draft.title,
      heading: HeadingLevel.HEADING_1
    }),
    ...markdownToParagraphs(redactSensitiveText(draft.content), docx)
  ]);
  const document = new Document({
    sections: [
      {
        properties: {},
        children
      }
    ]
  });
  const buffer = await Packer.toBuffer(document);
  return Buffer.from(buffer);
}

function markdownToParagraphs(markdown: string, docx: typeof import('docx')): DocxParagraph[] {
  const { Paragraph, TextRun, HeadingLevel } = docx;

  return markdown.split('\n').map((line) => {
    if (line.startsWith('# ')) {
      return new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 });
    }
    if (line.startsWith('## ')) {
      return new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 });
    }
    if (line.startsWith('- ')) {
      return new Paragraph({
        children: [new TextRun(line.slice(2))]
      });
    }
    return new Paragraph({ children: [new TextRun(line)] });
  });
}
