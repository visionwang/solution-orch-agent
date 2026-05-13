import type { MastraAgent } from './agentRuntime';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function loadConfig(overrides?: Partial<LlmConfig>): LlmConfig {
  return {
    baseUrl: overrides?.baseUrl ?? process.env.OPENAI_COMPAT_BASE_URL ?? 'https://api.deepseek.com/v1',
    apiKey: overrides?.apiKey ?? process.env.OPENAI_COMPAT_API_KEY ?? '',
    model: overrides?.model ?? process.env.OPENAI_COMPAT_MODEL ?? 'deepseek-chat',
  };
}

export function isLlmAvailable(): boolean {
  return !!process.env.OPENAI_COMPAT_API_KEY;
}

export async function callLlm(prompt: string, config?: Partial<LlmConfig>, agent?: MastraAgent): Promise<string> {
  if (agent) {
    const result = await agent.generate(prompt);
    return result.text;
  }

  const { baseUrl, apiKey, model } = loadConfig(config);

  if (!apiKey) {
    throw new Error('LLM API key not configured. Set OPENAI_COMPAT_API_KEY environment variable.');
  }

  const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => 'unknown error');
    throw new Error(`LLM API error (${response.status}): ${errorBody}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string | null } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM returned empty response');
  }

  return content;
}

function extractJson<T>(text: string): T {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = jsonMatch?.[1] ?? text;
  return JSON.parse(raw) as T;
}

export async function callLlmJson<T>(prompt: string, config?: Partial<LlmConfig>, agent?: MastraAgent): Promise<T> {
  if (agent) {
    const text = await callLlm(prompt, undefined, agent);
    return extractJson<T>(text);
  }
  const text = await callLlm(prompt, config);
  return extractJson<T>(text);
}
