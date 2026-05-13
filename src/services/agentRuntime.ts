import { Agent } from '@mastra/core/agent';
import { isLlmAvailable } from './llm';

export type MastraAgent = Agent<string, Record<string, never>, undefined, unknown>;

let requirementAnalystAgent: MastraAgent | null = null;
let productMatcherAgent: MastraAgent | null = null;
let draftWriterAgent: MastraAgent | null = null;
let reviewAgentAgent: MastraAgent | null = null;

function getModelConfig() {
  return {
    id: 'openai/deepseek-chat' as const,
    url: process.env.OPENAI_COMPAT_BASE_URL ?? 'https://api.deepseek.com/v1',
    apiKey: process.env.OPENAI_COMPAT_API_KEY ?? '',
  };
}

function createAgent(instructions: string): MastraAgent | null {
  if (!isLlmAvailable()) return null;
  return new Agent({
    id: `agent-${Math.random().toString(36).slice(2, 8)}`,
    name: `Agent`,
    instructions,
    model: getModelConfig(),
  });
}

export function getRequirementAnalyst(): MastraAgent | null {
  if (!requirementAnalystAgent) {
    requirementAnalystAgent = createAgent(
      `你是一个招标需求分析专家。从招标/需求文档中提取结构化需求。
要求：
1. 提取所有明确的功能性需求和约束条件
2. 每个需求包含：title（简洁标题）、description（完整描述）、priority（must/should/nice）
3. 必须（must）> 应当（should）> 建议（nice）
4. 返回 JSON 格式的数组

输出格式：
[
  { "title": "统一登录", "description": "系统必须支持统一登录", "priority": "must" }
]`
    );
  }
  return requirementAnalystAgent;
}

export function getProductMatcher(): MastraAgent | null {
  if (!productMatcherAgent) {
    productMatcherAgent = createAgent(
      `你是一个产品-需求匹配专家。判断产品能力与需求的匹配程度。
分析每条需求与所提供产品资料证据，输出匹配结果。

匹配状态：
- matched：产品完全满足需求，有明确证据
- partial：产品部分满足，证据不完整
- gap：产品不能满足或没有证据

输出 JSON 格式数组：
[
  { "requirementIndex": 0, "status": "matched", "score": 0.85, "rationale": "说明", "evidence": ["证据文本"] }
]

score 范围 0-1，matched >= 0.6，partial >= 0.18。`
    );
  }
  return productMatcherAgent;
}

export function getDraftWriter(): MastraAgent | null {
  if (!draftWriterAgent) {
    draftWriterAgent = createAgent(
      `你是一个投标方案撰写专家。根据需求清单和产品匹配结果撰写专业的解决方案和投标材料。

根据用户指令生成对应的 Markdown 格式文档。语言专业、逻辑清晰、面向投标场景。`
    );
  }
  return draftWriterAgent;
}

export function getReviewAgent(): MastraAgent | null {
  if (!reviewAgentAgent) {
    reviewAgentAgent = createAgent(
      `你是一个投标方案审核专家。审核解决方案和投标材料草稿，输出多维度审核意见。

审核维度：
- coverage：需求覆盖检查
- risk：承诺风险、缺失功能风险
- evidence：产品能力证据充分性
- format：格式与结构完整性

严重级别：critical / warning / info

输出 JSON 格式数组：
[
  { "type": "coverage", "severity": "warning", "title": "标题", "detail": "详细描述" }
]`
    );
  }
  return reviewAgentAgent;
}
