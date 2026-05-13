# Embedding 服务三层解耦重构计划

## Context

当前 `src/services/embedding.ts` 只有单一的云端 OpenAI 兼容 embedding 调用，无本地 provider、无路由策略、无缓存。随着产品资料增多和安全要求提高，需要：

- 同时注册本地和云端两类 embedding 服务
- 根据数据类型、安全等级、业务优先级动态路由
- 支持后续接入图像、视频等向量表示
- 高频请求结果做本地缓存

---

## 改动原则

- 改动要小，方便审查
- 向后兼容：不改现有调用方（vectorStore、productMatcher）的 API
- 三层解耦，每层可独立测试

---

## 三层设计

```
调用方 (vectorStore, productMatcher, etc.)
        │
        ▼
┌─────────────────────────────────┐
│   index.ts (公开 API)            │  ← 对外不变：getEmbedding / getEmbeddings / isEmbeddingAvailable
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│   cache.ts (缓存加速层)          │  ← LRU 内存缓存，key = hash(input + model + provider)
└─────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────┐
│   router.ts (策略控制层)         │  ← 根据 EmbedRequest.metadata 选择 provider
└─────────────────────────────────┘
        │
        ├────────────┬────────────┐
        ▼            ▼            ▼
┌──────────┐ ┌──────────┐ ┌──────────┐
│  local   │ │  cloud   │ │ (future) │
│ provider │ │ provider │ │  image/  │
│          │ │          │ │  video   │
└──────────┘ └──────────┘ └──────────┘
```

### 第 1 层：接口抽象层

**文件**：`src/services/embedding/types.ts`（新建）

定义统一契约：

```typescript
// 请求元数据
interface EmbedMetadata {
  classification?: 'internal' | 'confidential' | 'public';  // 数据安全等级
  priority?: 'low' | 'normal' | 'high';                      // 业务优先级
  modality?: 'text' | 'image' | 'video';                     // 数据类型
  model?: string;                                             // 指定模型
  [key: string]: unknown;                                     // 扩展
}

// 嵌入请求
interface EmbedRequest {
  inputs: string[];       // 文本或 base64
  metadata?: EmbedMetadata;
}

// 嵌入结果
interface EmbedResult {
  embeddings: number[][];
  provider: string;       // 实际使用的 provider ID
  cached: boolean;        // 是否命中缓存
}

// Provider 接口
interface EmbeddingProvider {
  id: string;
  embed(request: EmbedRequest): Promise<EmbedResult>;
  isAvailable(): boolean;
  supportedModalities(): string[];
}
```

**文件**：`src/services/embedding/providers/local.ts`（新建）

本地 provider（初期用简化实现，后续可接入 Transformers.js）：

```typescript
// 基于简单哈希的模拟嵌入（用于演示和回退）
// 后续可替换为 Transformers.js 或其他本地模型
```

**文件**：`src/services/embedding/providers/cloud.ts`（新建 → 搬迁现有逻辑）

从现有 `src/services/embedding.ts` 搬迁 OpenAI 兼容 API 调用逻辑，包装为 `EmbeddingProvider` 接口。

### 第 2 层：策略控制层

**文件**：`src/services/embedding/router.ts`（新建）

路由规则（可通过配置文件或环境变量控制）：

```typescript
// 路由策略
const defaultRoutingPolicy = {
  // 安全等级路由：内部数据走本地
  classification: {
    internal: 'local',
    confidential: 'local',
    public: 'cloud',
  },
  // 数据类型路由：图像走 cloud（本地暂不支持）
  modality: {
    text: 'auto',       // 自动根据 classification 判断
    image: 'cloud',     // 本地暂不支持图像嵌入
    video: 'cloud',
  },
  // 优先级路由：高优先级走本地（低延迟）
  priority: {
    high: 'local',
    normal: 'auto',
    low: 'cloud',
  },
  // 默认
  fallback: 'auto',     // 优先 cloud，不可用时 local
};
```

路由逻辑：
1. 检查 `metadata.classification` → 如果 internal/confidential，路由到 local
2. 检查 `metadata.modality` → 如果图像/视频，路由到 cloud
3. 检查 `metadata.priority` → 高优先级走 local
4. 默认 fallback：cloud 优先，不可用时 local
5. 目标 provider 不可用时，自动降级到可用 provider

### 第 3 层：缓存加速层

**文件**：`src/services/embedding/cache.ts`（新建）

- 内存 LRU 缓存，默认容量 1000 条
- 缓存 key = `${model}:${SHA256(input)}`
- 缓存过期时间：默认 24 小时
- 缓存统计：命中率、大小
- 提供 `clear()` 方法手动清理

### 公开发 API（不变）

**文件**：`src/services/embedding/index.ts`（新建 → 替代现有 embedding.ts）

```typescript
// 对外 API 不变
export { getEmbedding, getEmbeddings, isEmbeddingAvailable };
export { clearCache, getCacheStats } from './cache';
```

内部 `getEmbedding` 和 `getEmbeddings` 改为走缓存→路由→provider 链路。

---

## 实施步骤

### Step 1：创建接口抽象层

**文件**：
- `src/services/embedding/types.ts`（新建）— EmbedRequest / EmbedResult / EmbeddingProvider / EmbedMetadata
- `src/services/embedding/providers/local.ts`（新建）— 本地 provider
- `src/services/embedding/providers/cloud.ts`（新建，搬迁现有 embedding.ts 逻辑）

### Step 2：创建策略控制层

**文件**：`src/services/embedding/router.ts`（新建）

- 注册所有 provider（local + cloud）
- 实现路由决策函数
- 实现降级逻辑

### Step 3：创建缓存层

**文件**：`src/services/embedding/cache.ts`（新建）

- LRU 缓存实现
- 缓存统计

### Step 4：组装公开 API

**文件**：`src/services/embedding/index.ts`（新建）

- 组装三层
- 对外暴露 `getEmbedding` / `getEmbeddings` / `isEmbeddingAvailable`
- 保持与现有调用方兼容

### Step 5：更新引用方

**文件**：
- `src/services/vectorStore.ts` — 将 `from './embedding'` 改为 `from './embedding/index'`
- `src/agents/productKnowledge.ts` — 无需改动（通过 vectorStore 间接调用）
- `src/agents/productMatcher.ts` — 同上

### Step 6：删除旧文件

**文件**：`src/services/embedding.ts`（删除，逻辑已搬迁到 providers/cloud.ts 和 index.ts）

### Step 7：测试

**文件**：
- `tests/embedding.test.ts` — 更新测试，覆盖三层（provider 注册、路由策略、缓存命中/未命中）
- 新增 `tests/embedding-router.test.ts` — 路由策略测试
- 新增 `tests/embedding-cache.test.ts` — 缓存测试

---

## 文件变更一览

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/services/embedding/types.ts` | 接口抽象层：契约定义 |
| 新建 | `src/services/embedding/providers/local.ts` | 本地 provider |
| 新建 | `src/services/embedding/providers/cloud.ts` | 云端 provider（搬迁现有逻辑） |
| 新建 | `src/services/embedding/router.ts` | 策略控制层 |
| 新建 | `src/services/embedding/cache.ts` | 缓存加速层 |
| 新建 | `src/services/embedding/index.ts` | 组装 + 公开 API |
| **删除** | `src/services/embedding.ts` | 搬迁到 providers/cloud.ts + index.ts |
| 微调 | `src/services/vectorStore.ts` | 更新 import 路径 |
| 新建 | `tests/embedding-router.test.ts` | 路由策略测试 |
| 新建 | `tests/embedding-cache.test.ts` | 缓存测试 |
| 更新 | `tests/embedding.test.ts` | 适配新结构 |

---

## 验证方法

1. `npm test && npm run build` — 所有测试通过，构建成功
2. 设置 `OPENAI_COMPAT_API_KEY`，无 embedding key → cloud provider 自动降级到 local
3. 模拟 `metadata.classification='internal'` → 自动路由到 local provider
4. 相同输入连续两次调用 → 第二次命中缓存（`result.cached = true`）
5. 后续添加图像/视频 provider 只需实现 `EmbeddingProvider` 接口，无需改其他代码
