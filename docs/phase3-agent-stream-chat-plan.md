# 三期实施计划：Mastra Agent + 流式执行 + 多轮对话

## Context

二期已完成（LLM 集成 + Mastra Workflow），项目已具备语义处理能力和步骤级编排。接下来的三个方向：

- **B: Mastra Agent 替代原生 fetch** — 当前 LLM 调用用原生 `fetch`，需要 Mastra Agent 来获得 structured output、memory 和 tool use 能力
- **C: 流式执行 + 前端进度** — 当前 `POST /run` 同步阻塞，需要 SSE 推送和实时进度展示
- **D: 多轮对话式需求细化** — 新增对话交互，让用户能与 Agent 协作完善方案

**依赖关系**：C 的 SSE 基础设施是 D 的前置条件；B 的 Mastra Agent 是 D 中 chat Agent 的基础（memory + tools）。

---

## 改动原则

- 分步骤实现，每个步骤可独立验证
- 保持向后兼容，现有 API 不变
- 改动要小，方便审查

---

## 实施步骤

### Step 1: Mastra Agent 实例（B 基础）

**文件**：
- `src/services/agentRuntime.ts`（新建）

创建 Mastra Agent 配置和工厂函数：

```typescript
// Agent 工厂 + 各个专家 Agent 定义
// 使用 Mastra Agent 的 structured output 能力
// 支持 OpenAI 兼容 API（DeepSeek v4 Pro）
```

- 封装 `@mastra/core/agent` 的 Agent 创建
- 提供 `createRequirementAnalyst()`, `createProductMatcher()`, `createChatAgent()` 等工厂函数
- 配置 DeepSeek 模型（通过 OpenAI 兼容 provider）
- 不可用时回退到现有 fetch 方式

### Step 2: 升级 Workflow Steps 使用 Agent（B）

**文件**：
- `src/mastra/steps/requirementAnalysis.ts`（改造）
- `src/mastra/steps/productMatching.ts`（改造）
- `src/mastra/steps/draftGeneration.ts`（改造）
- `src/mastra/steps/aiReview.ts`（改造）

- 将步骤内部的 `callLlmJson()` 替换为 Mastra Agent 的 structured output 调用
- 保留 `isLlmAvailable()` 回退机制
- 行为不变，输出类型不变

### Step 3: Workflow 流式执行（C）

**文件**：
- `src/mastra/bidWorkflow.ts`（新增 `runBidWorkflowStream` 导出）
- `src/server.ts`（新增 SSE 路由 `GET /api/projects/:id/run/stream`）
- `src/web/api.ts`（新增 `runProjectStream` 函数）
- `src/web/App.vue`（新增进度面板，替换"运行流程"按钮触发流）

Mastra Workflow 支持 `run.stream()` 输出 step-by-step 事件：

```
event: step-start
data: {"stepId":"requirement-analysis"}

event: step-complete
data: {"stepId":"requirement-analysis","status":"success"}

event: step-start
data: {"stepId":"product-knowledge-indexing"}

event: complete
data: { ... WorkflowResult }
```

前端进度面板展示 6 步流程的状态指示灯（待执行 → 运行中 → 已完成 / 失败）。

### Step 4: 多轮对话（D）

**文件**：
- `src/agents/chatAgent.ts`（新建）
- `src/server.ts`（新增 SSE 路由 `POST /api/projects/:id/chat`）
- `src/web/api.ts`（新增 `postChatMessage` 函数）
- `src/web/App.vue`（新增对话面板，可收起/展开）

**Chat Agent 能力**：
- 查询当前项目需求清单、匹配结果、草稿内容
- 根据用户反馈修改需求项（增/删/改）
- 根据用户反馈重新生成草稿内容
- 回答问题：目前方案的覆盖情况、风险点

**Chat Agent 实现**：
- 使用 Mastra Agent + memory（内存级别即可）
- 注册 tools：`getRequirements`、`getMatches`、`getDrafts`、`updateRequirement`、`regenerateDraft`
- SSE 流式输出回复

### Step 5: 前端对话面板

**文件**：`src/web/App.vue`

- 新增对话面板，与现有 6 面板并列
- 消息列表（用户消息 + Agent 回复）
- 输入框 + 发送按钮
- 支持 markdown 渲染（Agent 回复中的结构化内容）
- 对话上下文保留当前项目的引用

### Step 6: 测试

**文件**：
- `tests/agentRuntime.test.ts`（新建）— Mastra Agent 实例化测试
- `tests/streaming.test.ts`（新建）— SSE 端点测试
- `tests/chatAgent.test.ts`（新建）— Chat Agent 逻辑测试
- 更新现有测试以覆盖新代码路径

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Chat Agent memory | 内存级别（`new InMemoryStorage()`） | 对话生命周期 = 页面会话，不需要持久化 |
| SSE vs WebSocket | SSE | 单向推送足够，实现简单，原生 `EventSource` 支持 |
| 对话面板位置 | 浮动面板（右下角） | 不占主工作区空间，可展开/收起 |
| Mastra Agent provider | OpenAI 兼容 provider | 保持 DeepSeek v4 Pro 兼容，沿用 `OPENAI_COMPAT_*` 环境变量 |

---

## 验证方法

1. **Step 1-2**：设置 API key，运行 `npm test`，确认 Agent 实例化和 structured output 正常
2. **Step 3**：前端运行流程，观察步骤指示灯依次变绿，无需等待完成即可看到进度
3. **Step 4-5**：对话面板输入"当前方案有哪些风险？"，确认 Agent 能检索项目数据并回复
4. **无密钥模式**：不设 API key，Step 1-2 回退到 fetch 方式，Step 3-5 不显示/禁用
