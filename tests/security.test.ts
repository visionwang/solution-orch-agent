import { describe, expect, it } from 'vitest';
import { redactSensitiveText } from '../src/shared/security';

describe('redactSensitiveText', () => {
  it('removes API keys, bearer tokens, env assignments and local workspace paths', () => {
    const text = [
      'OPENAI_COMPAT_API_KEY=sk-secret123',
      'Authorization: Bearer abc.def.ghi',
      '/Users/wangxz/work/codesandbox/solution-orch-agent/.data/upload.txt'
    ].join('\n');

    const redacted = redactSensitiveText(text);

    expect(redacted).not.toContain('sk-secret123');
    expect(redacted).not.toContain('Bearer abc.def.ghi');
    expect(redacted).not.toContain('/Users/wangxz');
    expect(redacted).toContain('[REDACTED]');
  });
});

