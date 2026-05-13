import type { DraftBundle, ProductMatch, RequirementItem, ReviewFinding } from '../shared/types';
import { isLlmAvailable } from '../services/llm';

interface ChatContext {
  requirements: RequirementItem[];
  matches: ProductMatch[];
  drafts: DraftBundle;
  reviewFindings: ReviewFinding[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

function buildSystemPrompt(context: ChatContext): string {
  return `你是一个投标方案智能助手。你正在协助用户完善一份投标方案。

## 当前项目数据

### 需求清单（${context.requirements.length} 条）
${context.requirements.map((r) => `- [${r.priority}] ${r.title}：${r.description}`).join('\n')}

### 产品匹配结果（${context.matches.length} 条）
${context.matches.map((m) => {
  const req = context.requirements.find((r) => r.id === m.requirementId);
  return `- ${req?.title ?? '未知'} → ${m.status}（${Math.round(m.score * 100)}%）`;
}).join('\n')}

### 草稿
- 解决方案：${context.drafts.solution?.content?.slice(0, 200) ?? '暂无'}...
- 投标材料：${context.drafts.bid?.content?.slice(0, 200) ?? '暂无'}...

### AI 审核意见（${context.reviewFindings.length} 条）
${context.reviewFindings.map((f) => `- [${f.severity}] ${f.title}`).join('\n')}

## 你的能力
1. 回答关于当前方案的问题（需求覆盖、匹配情况、风险点）
2. 根据用户反馈优化草稿内容（你可以重新生成方案章节）
3. 指出方案中的不足和改进建议

请用中文回答，简洁专业。`;
}

export async function chatStream(
  message: string,
  context: ChatContext,
  history: ChatMessage[],
  onChunk: (chunk: string) => void,
  onDone: () => void,
  onError: (error: string) => void,
): Promise<void> {
  if (!isLlmAvailable()) {
    onError('请先配置 LLM API 密钥以使用对话功能。');
    return;
  }

  const systemPrompt = buildSystemPrompt(context);
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    ...history.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ];

  const baseUrl = (process.env.OPENAI_COMPAT_BASE_URL ?? 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const apiKey = process.env.OPENAI_COMPAT_API_KEY ?? '';

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_COMPAT_MODEL ?? 'deepseek-chat',
        messages,
        temperature: 0.3,
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown error');
      onError(`LLM API error (${response.status}): ${errorBody}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      onError('Response body is not readable');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.text ?? '';
          if (content) onChunk(content);
        } catch {
          // Skip malformed chunks
        }
      }
    }

    onDone();
  } catch (error) {
    onError(error instanceof Error ? error.message : '对话请求失败');
  }
}
