import type { DraftBundle } from '../src/shared/types';
import { describe, expect, it, vi } from 'vitest';

describe('Chat agent module', () => {
  it('exports chatStream function', async () => {
    const mod = await import('../src/agents/chatAgent');
    expect(typeof mod.chatStream).toBe('function');
  });

  it('chatStream calls onError when LLM not available', async () => {
    const originalKey = process.env.OPENAI_COMPAT_API_KEY;
    delete process.env.OPENAI_COMPAT_API_KEY;

    const { chatStream } = await import('../src/agents/chatAgent');
    const onError = vi.fn();

    await chatStream(
      'test message',
      { requirements: [], matches: [], drafts: { solution: null, bid: null } as unknown as DraftBundle, reviewFindings: [] },
      [],
      () => {},
      () => {},
      onError,
    );

    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining('配置 LLM API 密钥')
    );

    process.env.OPENAI_COMPAT_API_KEY = originalKey;
  });
});
