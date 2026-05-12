import { describe, expect, it } from 'vitest';
import { parsePlainTextDocument } from '../src/services/documentParser';

describe('parsePlainTextDocument', () => {
  it('normalizes extracted text and keeps safe metadata', async () => {
    const result = await parsePlainTextDocument({
      fileName: '需求说明.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('  需要支持统一登录\\n\\n需要导出标书  ')
    });

    expect(result.text).toBe('需要支持统一登录\n需要导出标书');
    expect(result.metadata.fileName).toBe('需求说明.txt');
    expect(result.metadata.mimeType).toBe('text/plain');
    expect(JSON.stringify(result)).not.toContain(process.cwd());
  });
});

