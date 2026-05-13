# 多租户与权限设计方案

> 状态：设计完成，暂不实施

---

## 1. 现状

- 无用户概念，所有项目全局可见
- 前端直接访问 API，无认证层
- `POST /api/projects` 任何人可创建
- 项目间无隔离，无法区分归属

---

## 2. 设计目标

1. 每个项目归属一个租户（用户或团队）
2. 三种角色：所有者（owner）、协作者（editor）、只读（viewer）
3. API 级别鉴权，未登录请求拒绝
4. 前端增加登录/注册页面
5. 改动最小化，配置开关控制（不设 `JWT_SECRET` 时回退无鉴权模式）

---

## 3. 数据模型

新增 3 张表，`projects` 表加一列：

```sql
-- 用户表
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 项目成员表（多对多）
CREATE TABLE project_members (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  added_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

-- API Key 表（可选，程序化访问）
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

-- projects 新增列
ALTER TABLE projects ADD COLUMN owner_id TEXT;
```

### 角色权限矩阵

| 操作 | owner | editor | viewer |
|------|-------|--------|--------|
| 查看项目详情 | ✓ | ✓ | ✓ |
| 查看需求/匹配/草稿/审核 | ✓ | ✓ | ✓ |
| 运行流程 | ✓ | ✓ | ✗ |
| 编辑草稿 | ✓ | ✓ | ✗ |
| 上传文档 | ✓ | ✓ | ✗ |
| 导出 DOCX | ✓ | ✓ | ✓ |
| 对话交互 | ✓ | ✓ | ✓ |
| 评分评估 | ✓ | ✓ | ✗ |
| 添加/移除成员 | ✓ | ✗ | ✗ |
| 删除项目 | ✓ | ✗ | ✗ |

---

## 4. 认证流程

```
POST /api/auth/login     POST /api/auth/register
  {username, password}      {username, password, displayName}
         │                         │
         ▼                         ▼
   查 users 表                唯一性检查
   bcrypt.compare             bcrypt.hash
         │                         │
         └─────────┬───────────────┘
                   ▼
          签发 JWT（HS256）
          返回 { token, user }
```

JWT payload：
```json
{
  "sub": "user-uuid",
  "username": "zhangsan",
  "iat": 1700000000,
  "exp": 1700086400
}
```

### 认证开关

核心原则：**不设 `JWT_SECRET` = 整个认证层关闭**。

```typescript
// 向后兼容——未配置 JWT_SECRET 时回退当前无鉴权模式
const isAuthEnabled = () => !!process.env.JWT_SECRET;
```

- `JWT_SECRET` 未配置 → 跳过所有鉴权，保持现有行为
- `JWT_SECRET` 已配置 → 所有非公开路由强制鉴权
- Token 过期时间：默认 24h，可通过 `JWT_EXPIRY` 配置

---

## 5. API 鉴权规则

### 公开路由（无需认证）

| 路由 | 说明 |
|------|------|
| `POST /api/auth/login` | 登录 |
| `POST /api/auth/register` | 注册（可开关） |
| `GET /api/health` | 健康检查 |

### 受保护路由

| 路由 | 最低角色 |
|------|---------|
| `GET /api/projects` | 登录用户（只看自己的项目） |
| `POST /api/projects` | 登录用户 |
| `GET /api/projects/:id` | viewer |
| `POST /api/projects/:id/documents` | editor |
| `POST /api/projects/:id/run` | editor |
| `GET /api/projects/:id/run/stream` | editor |
| `GET /api/projects/:id/requirements` | viewer |
| `GET /api/projects/:id/matches` | viewer |
| `GET /api/projects/:id/drafts` | viewer |
| `PATCH /api/projects/:id/drafts/:draftId` | editor |
| `GET /api/projects/:id/review` | viewer |
| `POST /api/projects/:id/chat` | viewer |
| `GET /api/projects/:id/evaluations` | viewer |
| `PATCH /api/evaluations/:id` | editor |
| `POST /api/projects/:id/export/docx` | viewer |
| `POST /api/projects/:id/members` | owner |
| `DELETE /api/projects/:id/members/:userId` | owner |
| `DELETE /api/projects/:id` | owner |

---

## 6. 鉴权中间件

```typescript
// 请求 → parseJWT → 查用户 → 查角色 → 权限判断 → route
//                  ↓ 失败          ↓ 不可见    ↓ 不足
//              401            404         403
```

核心逻辑：
1. 从 `Authorization: Bearer <token>` 提取 JWT
2. 验证签名 + 过期时间
3. 查询 `users` 表确认用户存在
4. 查询 `project_members` 表确认角色
5. 按角色权限矩阵判断

---

## 7. 前端变更

### 新增 Login 组件

```
未登录态：
┌──────────┐  ┌──────────┐
│   登录    │  │   注册    │
└──────────┘  └──────────┘

登录后：
工作台顶部栏显示 "zhangsan ▼"（退出）
```

- Token 存储：`localStorage`
- 所有 `api.ts` 请求自动附加 `Authorization` header
- 项目列表只返回当前用户参与的项目

### 前端文件

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `src/web/Login.vue` | 登录/注册组件 |
| 改造 | `src/web/App.vue` | 未登录渲染 Login，登录后显示工作台 |
| 改造 | `src/web/api.ts` | 自动附带 token，新增 auth 接口 |
| 改造 | `src/web/styles.css` | 登录页样式 |

---

## 8. 实现路线

### Step 1：数据库层（无破坏性，纯加法）

**文件**：`src/storage/database.ts`

- 新增 3 张表（users、project_members、api_keys）
- projects 表加 `owner_id` 列
- 新增 CRUD 方法（createUser、getUserByUsername、addProjectMember 等）

### Step 2：JWT + 中间件

**文件**：
- `src/auth/jwt.ts` — 签发/验证
- `src/auth/middleware.ts` — 鉴权函数
- `src/auth/routes.ts` — login/register 路由

### Step 3：API 鉴权注入

**文件**：`src/server.ts`

- 注入中间件（`JWT_SECRET` 开关控制）
- 各路由按角色矩阵检查权限
- 列表接口按用户过滤项目

### Step 4：前端登录

**文件**：
- `src/web/Login.vue`
- `src/web/App.vue`（token 状态 + 条件渲染）
- `src/web/api.ts`（自动带 token）

### Step 5：权限 UI

- 所有不可操作的按钮/控件根据角色禁用
- 新增成员管理面板（owner 可见）

### Step 6：测试

- `tests/auth.test.ts` — JWT 签发/验证、中间件
- `tests/storage.test.ts` — 扩展用户/成员 CRUD

---

## 9. 安全考虑

| 项目 | 做法 |
|------|------|
| 密码存储 | bcrypt（cost=10） |
| Token | JWT HS256，24h 过期 |
| 密码强度 | 最小 8 位，含字母+数字 |
| 防暴力破解 | 可选：登录失败次数限制（Redis/journal） |
| 传输层 | HTTPS（部署层面） |
| 敏感操作 | 删除项目二次确认 |
| SQL 注入 | 参数化查询（已有） |

---

## 10. 扩展方向（后续）

- **OAuth2 集成**：接入企业 SSO（飞书/钉钉/企微）
- **API Key 管理**：前端面板创建/撤销 API Key，用于 CI/CD 或程序化访问
- **团队/组织**：在用户与项目之间加一层 `team`，支持多人共享
- **审计日志**：记录关键操作（创建/删除/运行），SQLite 或文件存储
- **速率限制**：按用户或 IP 限流，防止滥用
