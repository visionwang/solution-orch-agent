# 多 Agent 记忆能力提升计划

## 现状分析

| 组件 | 当前记忆 | 问题 |
|------|---------|------|
| Chat Agent | `Map<projectId, ChatMessage[]>` 在 server.ts 内存 | 服务重启丢失，无语义检索，每项目最多 30 条 |
| Mastra Agents（4 个） | 无 | 每次调用都是冷启动，无上下文，无跨调用学习 |
| Workflow Agents | 无 | 每次运行从零开始，不能利用历史运行结果 |
| 各 Agent 之间 | 完全隔离 | 如需求分析结果不传递给审核 Agent 作为上下文 |

Mastra 内置但未使用的记忆能力：

| 能力 | 说明 | 当前状态 |
|------|------|---------|
| `MemoryConfig` | 线程/用户/最后 N 条消息管理 | 未配置 |
| `MastraMemory` | 持久化消息存储（抽象，可用 SQLite 实现） | 未使用 |
| Semantic Recall | 上下文相关消息的向量语义检索 | 未配置 |
| Working Memory | 跨对话持久化动态上下文（模板/Schema） | 未配置 |
| Observational Memory | 反思提取长期记忆 | 未配置 |

---

## 可提升的方向

### 方向 A：会话记忆持久化（低难度，高收益）

**问题**：Chat Agent 对话历史在内存，服务重启即丢失。

**方案**：
- 新增 `conversations` 表存储对话历史
- `db.saveMessage(projectId, role, content)` / `db.getMessages(projectId, limit)`
- Chat Agent 启动时从 DB 恢复最近 N 条历史消息
- 支持 `db.clearMessages(projectId)` 手动清理

**改动文件**：`src/storage/database.ts` + `src/server.ts` + `src/agents/chatAgent.ts`

**收益**：用户体验连续，重启不丢对话。

---

### 方向 B：Agent 线程化（中难度，中收益）

**问题**：Mastra Agent 没有 `memory` 配置，每次调用是孤立的 API 请求。

**方案**：利用 Mastra `MemoryConfig` + `MockMemory`（或自实现 SQLiteMemory）：

```typescript
// agentRuntime.ts 改造
function createAgent(instructions: string, memory?: MastraMemory) {
  return new Agent({
    instructions,
    model: getModelConfig(),
    memory,  // 新增
  });
}
```

`MemoryConfig` 控制：
- `lastMessages: 20` — 最近 N 条消息作为上下文
- `semanticRecall: { topK: 5, messageRange: 2 }` — 语义检索相关历史
- `threads` / `resources` — 隔离不同项目/用户的对话

**改动文件**：`src/services/agentRuntime.ts` + `src/storage/database.ts` + 新增 `src/services/memory.ts`

**收益**：Agent 具备短期记忆和语义检索能力。

---

### 方向 C：Working Memory 跨对话上下文（中难度，高收益）

**问题**：Agent 不记得用户偏好、项目背景和之前的需求修正。

**方案**：利用 Mastra Working Memory（template-based）：

```typescript
// 项目级别的 working memory
const projectWorkingMemory = {
  enabled: true,
  scope: 'resource',   // 同 resource（项目）跨线程共享
  template: `
# 项目上下文
- 项目名称：{projectName}
- 行业领域：{industry}
- 关键约束：{constraints}
- 上次运行时间：{lastRunAt}
- 审核重点：{reviewFocus}

# 用户偏好
- 草稿风格：{draftStyle}
- 关注模块：{focusModules}
  `,
};
```

Agent 对话过程中自动更新 working memory，下次调用时注入。

**改动文件**：`src/services/agentRuntime.ts` + `src/storage/database.ts`

**收益**：Agent 记住项目演进历史和用户偏好，减少重复说明。

---

### 方向 D：跨 Agent 共享记忆总线（高难度，高收益）

**问题**：5 个 Workflow Agent 之间完全隔离，需求分析的结果无法作为审核的上下文，审核发现也无法反馈给草稿生成。

**方案**：构建 Agent 间共享上下文总线：

```
┌──────────────┐
│ AgentContext  │  共享状态对象，随 Workflow 步骤传递
├──────────────┤
│ requirements │  需求分析结果
│ matches      │  匹配结果（含历史对比）
│ drafts       │  草稿版本历史
│ reviewHistory│  审核发现历史
│ userFeedback │  用户反馈记录
│ metrics      │ 上次运行指标（覆盖率、匹配分数等）
└──────────────┘
       │
       ▼
┌──────────────────────────────────────┐
│  每个 Agent 调用时注入 AgentContext   │
│  + 前一步 Agent 的输出摘要            │
└──────────────────────────────────────┘
```

在 Workflow 的 `runBidWorkflowWithProgress` 中传递累积 context。

**改动文件**：`src/mastra/bidWorkflow.ts` + 各 Agent 函数签名

**收益**：Agent 之间信息不丢失，审核 Agent 可以引用需求分析的具体输出。

---

### 方向 E：长期知识积累（高难度，长期收益）

**问题**：Agent 不会从历史项目中学习。每次开新项目，所有知识都要重新获取。

**方案**：
- 利用 Mastra Observational Memory，从对话中提取"观察"存入长期记忆
- 跨项目共享产品知识库——在 `vectorStore` 中持久化（不按项目清理）
- 积累常见需求模板/匹配模式/审核规则

**改动文件**：`src/services/agentRuntime.ts` + `src/services/vectorStore.ts` + `src/storage/database.ts`

**收益**：使用越多，Agent 越"聪明"，类似经验积累。

---

## 实施建议

| 优先级 | 方向 | 难度 | 收益 | 依赖 |
|--------|------|------|------|------|
| P0 | A: 会话持久化 | 低 | 高 | 无 |
| P1 | D: 跨 Agent 共享上下文 | 中 | 高 | 无 |
| P2 | C: Working Memory | 中 | 高 | B 部分基础 |
| P3 | B: Agent 线程化 | 中 | 中 | A + Mastra Memory 接口 |
| P4 | E: 长期知识积累 | 高 | 长 | A + B + 现有 vectorStore |

建议 A + D 先做，效果立竿见影。
