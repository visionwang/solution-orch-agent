# 四期实施计划：向量检索 + 评估体系

## Context

前三期已完成，项目具备语义理解和对话交互能力。当前瓶颈：
- **产品匹配**：LLM 模式将全部知识块拼入 Prompt，随产品资料增多成本上升、效果下降
- **质量保障**：没有系统化评估 LLM 输出的手段，无法量化 LLM 模式相比规则模式的提升

---

## 改动原则

- 两个方向独立实施，互不阻塞
- 保持向后兼容，不破坏现有流程
- 改动要小，方便审查

---

## 方向1：向量数据库 + 语义检索

### 问题

`productMatcher.ts` 的 `matchProductsViaLlm` 把所有知识块拼入 LLM Prompt：

```
const knowledgeText = chunks.map(...).join('\n\n');
```

产品资料多了 Prompt 会超 token 限制，且无关知识块干扰匹配质量。

### 方案

用向量检索代替"全量拼入 Prompt"：先向量检索出最相关的 K 个知识块，再交给 LLM 做最终匹配判断。

### 嵌入模型选择

DeepSeek 不提供 embedding API，两种路线：

| 路线 | 方案 | 依赖 | 优点 | 缺点 |
|------|------|------|------|------|
| A: 本地嵌入 | `@xenova/transformers` | 约 30MB + 模型文件 | 无需 API Key，完全离线 | 首次加载慢，模型质量一般 |
| B: 远程 API | OpenAI embedding API | `OPENAI_EMBEDDING_API_KEY` | 质量高，成熟稳定 | 需要额外 API Key |

**推荐路线 B**：配置灵活，质量可靠。不配置时回退现有 LLM 语义匹配。

### 实施步骤

#### Step 1：嵌入服务

**文件**：`src/services/embedding.ts`（新建）

- OpenAI 兼容 embedding API 客户端（支持 `text-embedding-3-small` 等模型）
- `getEmbedding(text: string): Promise<number[]>` 单条嵌入
- `getEmbeddings(texts: string[]): Promise<number[][]>` 批量嵌入
- 不可用时抛出清晰错误

#### Step 2：向量存储

**文件**：
- `src/services/vectorStore.ts`（新建）
- `src/storage/database.ts`（新增 `vector_chunks` 表）

实现一个轻量向量存储层，基于 SQLite：

```sql
CREATE TABLE vector_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding TEXT NOT NULL,  -- JSON 数组
  created_at TEXT NOT NULL
);
```

接口：
- `storeChunks(chunks: KnowledgeChunk[], embeddings: number[][])`
- `searchSimilar(query: string, topK: number): Promise<SearchResult[]>`
  - 内部：`getEmbedding(query)` → 与所有存储向量计算余弦相似度 → 返回 topK
- `clearChunks(projectId: string)` — 重新索引时清理旧数据

#### Step 3：改造产品知识索引

**文件**：`src/agents/productKnowledge.ts`

- `indexProductKnowledge` 在 LLM 模式下增加 embedding 步骤
- 先调用 LLM 做语义分块（现有逻辑不变）
- 再调用 embedding API 为每个知识块生成向量
- 将向量 + 内容写入 `vectorStore`

#### Step 4：改造产品匹配

**文件**：`src/agents/productMatcher.ts`

- `matchProductsViaLlm` 改为两步：
  1. 对每条需求调用 `vectorStore.searchSimilar(需求文本, topK=5)` 找出最相关知识块
  2. 只将 topK 知识块拼入 LLM Prompt 做最终匹配判断
- 不可用时回退现有全量 Prompt 方式

#### Step 5：清理与回退

- 嵌入服务不可用（无 API Key / 网络错误）时，现有 LLM 语义匹配逻辑不变
- 向量表在 `saveWorkflowResult` 事务中一起清理

---

## 方向5：评估与质量保障

### 问题

无法量化回答质量：
- LLM 模式比规则模式好多少？
- 哪些需求提取漏了？匹配错了？
- 改了什么？退步了还是进步了？

### 方案

构建轻量评估框架：记录每次运行的输入/输出，支持人工评分 + 对比。

#### Step 1：评估数据模型

**文件**：`src/storage/database.ts`（新增 `evaluations` 表）

```sql
CREATE TABLE evaluations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  category TEXT NOT NULL,   -- 'requirements' | 'matching' | 'draft' | 'review'
  mode TEXT NOT NULL,       -- 'rule' | 'llm'
  input_snapshot TEXT,      -- JSON
  output_snapshot TEXT,     -- JSON
  score REAL,               -- 0-100，NULL 表示未评分
  notes TEXT,
  created_at TEXT NOT NULL
);
```

#### Step 2：评估采集点

**文件**：`src/mastra/bidWorkflow.ts`（改造）

在 `runBidWorkflowWithProgress` 中，每个步骤完成后记录评估快照：

```
step 完成 → 记录 { category, mode, input, output } 到 evaluations 表
```

通过环境变量 `ENABLE_EVALUATION=true` 控制是否开启采集（默认关闭，不影响演示）。

#### Step 3：评估 API

**文件**：`src/server.ts`（新增路由）

- `GET /api/projects/:id/evaluations` — 列出项目的所有评估记录，按 category 分组
- `PATCH /api/evaluations/:id` — 人工评分 `{ score: 85, notes: "..." }`

#### Step 4：前端评估面板

**文件**：`src/web/App.vue`（新增面板）

- 在 "运行流程" 按钮旁增加 "评估" 模式开关
- 评估模式下，每次运行自动记录快照
- 新增评估面板，展示各 category 的评分列表
- 支持对单条记录打分 + 写备注
- 支持对比两次运行的输出差异（规则 vs LLM）

#### Step 5：测试

- `tests/embedding.test.ts` — 嵌入服务单元测试
- `tests/vectorStore.test.ts` — 向量存储 CRUD + 相似搜索测试
- `tests/evaluation.test.ts` — 评估数据模型测试

---

## 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 嵌入 API | OpenAI 兼容（`/v1/embeddings`） | 与现有 `OPENAI_COMPAT_*` 配置风格一致 |
| 向量搜索 | 内存余弦相似度 | 数据量小（单项目 <1000 块），无需引入外部向量数据库 |
| 评估开关 | 环境变量 `ENABLE_EVALUATION` | 默认关闭，不影响演示和性能 |
| 对比方式 | 前端并排展示两次运行结果 | 直观，用户可自行判断差异 |

---

## 验证方法

1. **方向1**：上传包含多个产品资料的大文档，LLM 模式的 匹配步骤只发送相关片段，成本降低
2. **方向1 回退**：不配置 embedding API Key，匹配逻辑自动回退到现有关键词/LLM 全量方式
3. **方向5**：打开评估模式运行一次，查看 evaluations 表有记录；对记录打分；关闭评估模式不再采集
4. **构建与测试**：`npm test && npm run build`
