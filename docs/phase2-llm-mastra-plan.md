# 二期实施计划：LLM 集成 + Mastra 工作流深度接入

## Context

当前一期是**确定性规则引擎**原型：需求提取靠关键词匹配，产品匹配靠 TF 重叠评分，草稿生成靠模板拼接，AI 审核靠 if/else 规则。所有 Agent 没有真正调用任何 LLM。Mastra 集成也只是一个薄函数管道，未使用 Mastra 的 Workflow 编排引擎。

二期目标：
1. 基于现有 `OPENAI_COMPAT_*` 环境变量配置，接入 DeepSeek v4 Pro（OpenAI 兼容 API），使各 Agent 具备真正的语义理解能力
2. 使用 Mastra 的 `createStep` / `createWorkflow` 替代手动函数链，获得步骤级状态管理、可观测性和执行控制

---

## 改动原则

- **改动要小，方便审查**：尽量在每个文件的原地替换逻辑，不搞大规模重命名或重构
- **保持向后兼容**：未配置 LLM 密钥时自动回退到一期确定性规则，确保无密钥也能演示
- **测试优先**：每个 LLM Agent 需要补单元测试

---

## 实施步骤

### Step 1：LLM 客户端模块

**文件**：`src/services/llm.ts`（新增）

封装 DeepSeek v4 Pro 的调用。因为 DeepSeek 使用 OpenAI 兼容 API，直接用原生 `fetch` 即可，不额外引入 `openai` 包。

```typescript
// 核心接口
interface LlmConfig {
  baseUrl: string;      // 默认从环境变量读取
  apiKey: string;       // 默认从环境变量读取
  model: string;        // 默认从环境变量读取
}

async function callLlm(prompt: string, config?: Partial<LlmConfig>): Promise<string>
async function callLlmJson<T>(prompt: string, config?: Partial<LlmConfig>): Promise<T>
```

- 从 `process.env.OPENAI_COMPAT_BASE_URL / API_KEY / MODEL` 读取配置
- 提供 `isLlmAvailable()` 函数供各 Agent 判断是否回退
- 已有环境变量（`OPENAI_COMPAT_BASE_URL`、`OPENAI_COMPAT_API_KEY`、`OPENAI_COMPAT_MODEL`）

### Step 2：升级需求提取 Agent

**文件**：`src/agents/requirementAnalyst.ts`

- `extractRequirements()` 改为：如果 LLM 可用，调用 LLM 做语义提取（传入完整文档文本，返回结构化 `RequirementItem[]`）
- LLM 不可用时走原有关键词逻辑
- Prompt 设计：要求 LLM 从招标/需求文档中提取结构化需求，推断优先级，给出简洁标题

### Step 3：升级产品知识索引 Agent

**文件**：`src/agents/productKnowledge.ts`

- `indexProductKnowledge()` 改为：如果 LLM 可用，调用 LLM 对产品资料做语义分块和关键词/能力标签提取
- 不可用时走原有关键词逻辑

### Step 4：升级产品匹配 Agent

**文件**：`src/agents/productMatcher.ts`

- `matchProducts()` 改为：如果 LLM 可用，调用 LLM 逐条判断需求与知识块的匹配度，返回 `matched / partial / gap`
- LLM Prompt 传入需求原文 + 知识块内容，要求输出匹配状态、评分（0-1）、依据说明和证据文本
- 不可用时走原有关键词重叠评分

### Step 5：升级草稿生成 Agent

**文件**：`src/agents/draftWriters.ts`

- `generateDrafts()` 改为：如果 LLM 可用，调用 LLM 根据需求 + 匹配结果生成更自然、更详细的解决方案和投标材料草稿
- 不可用时走原有模板拼接逻辑
- 输出格式保持 markdown，与前端编辑器兼容

### Step 6：升级审核 Agent

**文件**：`src/agents/reviewAgent.ts`

- `reviewDrafts()` 改为：如果 LLM 可用，调用 LLM 审阅草稿，输出覆盖、风险、证据充分性、格式等多维度审核意见
- 不可用时走原有关键词规则

### Step 7：Mastra Workflow 深度接入

**文件**：
- `src/mastra/bidWorkflow.ts`（重写）
- `src/mastra/steps/`（新建目录，每个 Agent 一个 Mastra Step 文件）
- `src/server.ts`（微调）

把当前的函数链改为真正的 Mastra Workflow：

```typescript
// src/mastra/steps/requirementAnalysis.ts
import { createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import { extractRequirements } from '../../agents/requirementAnalyst';

export const requirementAnalysisStep = createStep({
  id: 'requirement-analysis',
  inputSchema: z.object({
    documents: z.array(z.any()),
  }),
  outputSchema: z.object({
    requirements: z.array(z.any()),
  }),
  execute: async ({ inputData }) => {
    const requirements = await extractRequirements(inputData.documents);
    return { requirements };
  },
});
```

5 个 Step 文件：
- `steps/requirementAnalysis.ts`
- `steps/productIndexing.ts`
- `steps/productMatching.ts`
- `steps/draftGeneration.ts`
- `steps/aiReview.ts`

```typescript
// src/mastra/bidWorkflow.ts（重写）
import { createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { requirementAnalysisStep } from './steps/requirementAnalysis';
// ... 其他 step

export const bidWorkflow = createWorkflow({
  id: 'solution-orch-bid-workflow',
  inputSchema: z.object({
    projectId: z.string(),
    documents: z.array(z.any()),
  }),
  outputSchema: z.object({
    projectId: z.string(),
    requirements: z.array(z.any()),
    matches: z.array(z.any()),
    drafts: z.any(),
    reviewFindings: z.array(z.any()),
    completedAt: z.string(),
  }),
})
  .then(requirementAnalysisStep)
  .then(productIndexingStep)
  .then(productMatchingStep)
  .then(draftGenerationStep)
  .then(aiReviewStep)
  .commit();
```

`server.ts` 改动：将 `runBidWorkflow()` 替换为 Mastra workflow 的执行逻辑：
```typescript
const run = bidWorkflow.createRun();
const result = await run.start({ inputData: { projectId, documents } });
// 从 result 中提取 output
```

### Step 8：更新类型与配置

- `.env.example` 确认已有 `OPENAI_COMPAT_*` 配置
- 确保 `src/shared/types.ts` 中的类型对 LLM 返回格式兼容（实际无需改动，当前类型已通用）

### Step 9：测试

新增测试文件：
- `tests/llm.test.ts` — LLM 客户端模块单元测试（mock fetch 测试 prompt 组装和 JSON 解析）
- `tests/agents-llm.test.ts` — 各 Agent 在 LLM 模式下的行为测试（mock LLM 响应 + 验证结构化输出）

更新现有测试（已有 5 个测试文件）：
- 原有测试使用确定性规则运行，不受 LLM 集成影响（只要不设 API KEY 就会走回退路径）
- 如需验证 LLM 路径，使用 mock

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| LLM 客户端 | 原生 `fetch`，不引入 `openai` SDK | 减少依赖，DeepSeek 的 API 兼容 OpenAI 格式，fetch 足够 |
| Workflow 执行方式 | `createRun()` + `.start()` | Mastra 标准模式，获得步骤级追踪和状态管理 |
| 回退策略 | 环境变量判断 `isLlmAvailable()` | 保持无密钥可演示，环境影响平滑 |
| Step 位置 | 单独的 `src/mastra/steps/` 目录 | 每个 Step 文件职责单一，不混入 Agent 逻辑 |

## 验证方法

1. **无密钥模式**：不设环境变量，运行 `npm test`，所有测试通过，前端演示正常
2. **LLM 模式**：设 `OPENAI_COMPAT_API_KEY` 指向 DeepSeek v4 Pro，`npm run dev` 启动后上传示例文档，观察输出质量提升
3. **Workflow 执行**：LLM 模式下查看 Mastra 步骤是否顺序执行、结果是否正确传递
4. **前端兼容**：数据结构不变，前端无需改动
