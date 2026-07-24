# MIS × ai-platform 深度融合 — 交付与进度同步

> 最后更新：2026-07-24 ｜ 范围：阶段5 前端 AI 融合 MVP（F0–F7）+ 阶段5 后端扩展（T-ext / T-sum / T-stream）

## 一、TL;DR

- 前端 AI 融合 MVP 已实现并 **build 绿**（tsc 0 错误，vite build 通过）。
- 后端扩展补齐「精度 + 流式」缺口：extract 逐字段置信度、summary 结构化、Copilot 真流式 SSE。
- 全链路经 QA 验证判定 **NoOne（无源码 Bug）**；Java BFF 受沙箱 JDK8 限制仅静态评审，待内网 JDK17 CI。

## 二、交付范围与进度

### 阶段5 — 前端 AI 融合 MVP（F0–F7）✅

- UC-1 聊天填表单、UC-2 摘要、UC-3 智能录入、UC-4 RAG、UC-5 Copilot 浮窗。
- fail-closed 门禁：未登录 / `/ai/features` 失败 → 隐藏 AI 入口（默认空特性集）。
- 平台 Python 全量 pytest 170 passed；前端 typecheck / build 绿。

### 阶段5-ext（A）— 后端扩展 ✅

- **T-ext**：extract 响应 `confidence` 由标量升级为 `Map<String,Double>` 逐字段 + `unmapped: List<Map<raw,hint>>`；平台 mis-extract prompt 对齐。
- **T-sum**：summary 响应结构化 `summary` + `points[{label,value,risk}]` + `citations[{field,value,source}]`；平台 mis-summary prompt 对齐。
- **T-stream**：BFF 新增 `chatStream` SSE 1:1 透传（接活 `sseEnabled` 总开关）；前端 `fetch-event-source` 升级为 `@microsoft/fetch-event-source` + `useAI`/`ai-copilot` 翻 `stream:true`。

## 三、验证矩阵

| 层 | 方式 | 结果 |
|----|------|------|
| 平台 Python | pytest 实跑 | **170 passed** |
| 前端 TS | `tsc --noEmit` + `vite build` | 0 错误，build 绿 |
| BFF Java | 静态评审（沙箱 JDK8 不可编译） | 11 文件内部一致；关键风险 `spring-webflux` 在 classpath 已确认；待内网 JDK17 CI |
| QA 智能路由 | — | **NoOne**（无源码 Bug） |

## 四、已知问题 / 待办（均非阻断）

1. **生产须置 `mis.ai-platform.sse-enabled=true`**：默认 `false` 时 `stream` 静默降级为缓冲（UC-5 不真流式）。
2. **BFF Java 待内网 JDK17 CI 编译闸门 + SSE 端到端联调**（首字 P95 < 1s 目标）。
3. **401 透传** 维持 P2 现状（平台 401 被 BFF 折为 `INTERNAL_ERROR`，已留改造点）。
4. **UC-4 RAG 仍为非流式**：BFF SSE 分支仅挂 `/ai/chat/completions`→mis-copilot；RAG 流式（US-STREAM-2）需 BFF 按 capability 路由到 mis-rag，后续增强。
5. **fetch-event-source 包名**：npm 无 v3（仅 1.0.0-alpha 且只默认导出），改用微软官方 `@microsoft/fetch-event-source@^2.0.1`（等价具名 `fetchEventSource`）。

## 五、在哪里看到 AI 效果

- **UC-1 聊天填表单**：系统管理任意页 → 新建/编辑 Sheet → 顶部「AI 填充」或字段旁 Sparkles → 对话/贴文本/传文件 → 字段预览（逐字段置信标红）→ 确认回填。
- **UC-5 Copilot**：右上角 Sparkles 或 `Cmd/Ctrl+J` 唤起浮窗，流式 Markdown 输出。
- **UC-2 / UC-3 / UC-4**：列表详情头部摘要卡片、工具栏「智能录入」、详情「AI 问答」。

## 六、相关文档

| 文档 | 内容 |
|------|------|
| `docs/frontend-ai-integration-prd.md` | 阶段5 主 PRD（UC-1~6 需求池 / UI 设计稿） |
| `docs/frontend-ai-integration-design.md` | 阶段5 集成设计（前后端契约 / 任务总表） |
| `docs/backend-integration-audit.md` | 后端集成契约审计（BFF↔ai-platform，无阻断性坑） |
| `docs/backend-ext-prd.md` | 后端扩展增量 PRD（T-ext / T-sum / T-stream） |
| `docs/backend-ext-design.md` | 后端扩展增量设计（含 `backend-ext-class.mermaid` / `backend-ext-sequence.mermaid`） |
| `docs/identity-enrichment-task-list.md` | 身份 enrichment（多组织 T6）任务清单 |
| `docs/jwt-identity-clarification.md` | JWT / 身份澄清决策 |

## 七、下一步

- 内网 JDK17 CI 编译闸门 + SSE 联调（含 `sse-enabled=true` 配置）。
- 可选增强：US-STREAM-2（RAG 流式）、401 透传（P2）。
