# 需求到投标智能方案生成 Agent

## 项目简介

这是一个从需求文档到解决方案/投标材料草稿的端到端原型。系统通过 Vue3 工作台上传需求、招标和产品资料，后端执行文档解析、需求抽取、产品匹配、方案生成和 AI 审核流程，最终提供可编辑草稿与 DOCX 导出。

一期目标是跑通可演示闭环，不包含扫描件 OCR、多租户权限、复杂 DOCX 模板排版和生产级向量数据库。

## 技术栈

- 前端：Vue3 + Vite + TypeScript
- 后端：Node.js + TypeScript 原生 HTTP 服务
- Agent 编排：Mastra 依赖与工作流封装
- 数据存储：Node 24 `node:sqlite`
- 文档解析：`mammoth`、`xlsx`、`pdf-parse`
- 导出：`docx`
- 测试：Vitest

## 核心流程

1. 创建投标/方案项目。
2. 上传需求/招标文档、产品资料和参考材料。
3. 解析 Word、Excel、PDF 或文本内容。
4. 抽取结构化需求清单。
5. 从产品资料生成知识片段。
6. 按需求匹配产品能力，标记满足、部分满足或缺口。
7. 生成解决方案草稿和投标材料草稿。
8. 输出 AI 审核意见，提示遗漏、证据不足和风险承诺。
9. 人工编辑草稿并导出 DOCX。

## 目录说明

```text
docs/          项目文档
samples/       示例需求和产品资料
src/agents/    专家 Agent 的确定性原型逻辑
src/mastra/    端到端 Workflow 封装
src/services/  文档解析与 DOCX 导出
src/storage/   SQLite 数据层
src/web/       Vue3 工作台
tests/         单元与集成测试
```

## 本地启动

安装依赖：

```bash
npm install
```

启动前后端开发服务：

```bash
npm run dev
```

默认地址：

- 前端：http://localhost:5173/
- API：http://127.0.0.1:8787

## 环境变量

参考 `.env.example`：

```bash
OPENAI_COMPAT_BASE_URL=https://api.openai.com/v1
OPENAI_COMPAT_API_KEY=
OPENAI_COMPAT_MODEL=gpt-4.1-mini
API_HOST=127.0.0.1
API_PORT=8787
DATA_DIR=.data
```

当前原型默认使用确定性规则生成结果，即使未配置模型密钥也能完成端到端演示。不要把真实密钥写入代码、文档或提交记录。

## 使用示例

1. 打开前端工作台。
2. 创建项目。
3. 上传 `samples/requirement.txt`，类型选择“需求/招标”。
4. 上传 `samples/product.txt`，类型选择“产品资料”。
5. 点击“运行流程”。
6. 查看需求清单、产品匹配、草稿编辑和 AI 审核意见。
7. 点击“导出 DOCX”获取可编辑文档。

## 验证命令

运行测试：

```bash
npm test
```

运行构建：

```bash
npm run build
```

当前覆盖：

- 文档解析归一化
- 需求抽取
- 产品知识与匹配
- 草稿生成和审核意见
- SQLite 存储集成
- 敏感信息脱敏

## API 概览

- `GET /api/health`
- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:id`
- `POST /api/projects/:id/documents`
- `POST /api/projects/:id/run`
- `GET /api/projects/:id/requirements`
- `GET /api/projects/:id/matches`
- `GET /api/projects/:id/drafts`
- `PATCH /api/projects/:id/drafts/:draftId`
- `GET /api/projects/:id/review`
- `POST /api/projects/:id/export/docx`

## 注意事项

- 需要 Node.js 24 以上版本，因为项目使用 `node:sqlite`。
- `node:sqlite` 当前会打印 ExperimentalWarning，测试已覆盖基本读写行为。
- `.data/`、`dist/`、`node_modules/` 和 `.env` 已在 `.gitignore` 中忽略。
- API 返回会隐藏服务端上传文件路径，避免把本地路径暴露给前端。

