declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
  }

  export default function pdfParse(buffer: Buffer): Promise<PdfParseResult>;
}

