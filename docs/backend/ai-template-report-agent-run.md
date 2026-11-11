# 模板报告 · 智能体成文与缓存

## 职责

| 组件 | 职责 |
|------|------|
| mis-ai-template-report | ACL、槽位校验、提示词渲染、成文缓存读写、按平台分流 `cached` / `agent_run` |
| AdminWeb CopilotPanel | 参数卡「重新生成」；`mode=cached` 直接展示正文；其它平台硬派发 + 回写 |
| ai-platform Worker | 非百炼平台：取数/工具/成文；`metadata.ai_report_run` 强制 agent + 可选 skill |
| 阿里百炼 DashScope | `workflow_platform_code=aliyun-bailian` 时 Java 同步 `apps/{APP_ID}/completion` |

## 报告定义字段

- `use_ai_workflow`：启用智能体成文
- `workflow_platform_code`：平台编码（如 `aliyun-bailian`、`default-ai-wf`）
- `workflow_code`：工作流编号（展示/兼容；非百炼时必填）
- `workflow_key`：工作流 key。选 **阿里百炼** 时必填，值为控制台 **应用 ID（APP_ID）**，不是 API Key
- `target_agent_id`：非百炼时硬派发 Worker（必填）；百炼路径不派发 Worker
- `target_skill_id`：可选，成文 Skill（日报 `sm-shop-ops-diary-report`、周报 `week-report`、月报 `month-report`）。**不是** router
- `prompt_template`：任务消息模板（`{{wire_key}}`）
- `cache_ttl_hours`：缓存 TTL，默认 24

**API Key**：平台级，环境变量 / Nacos `MIS_BAILIAN_API_KEY`（`mis.ai-report.bailian.api-key`）。禁止写入 `ai_report_def`、`config_json` 或报告编辑表单。V165 种子 `{"provider":"aliyun-bailian"}` 保持无密钥。

## execute

请求：`reportCode`、`params`、`regenerate`（参数卡「重新生成」）。

| 条件 | 读缓存 | 响应 | 写缓存 |
|------|--------|------|--------|
| regenerate=false 且命中 | 是 | `mode=cached` + `content_md` | 否 |
| 平台 `aliyun-bailian`（未命中或 regenerate） | 否或未命中 | `mode=cached` + `content_md`（同步百炼正文） | 服务端直接写 |
| 其它平台未命中 / regenerate | 否或未命中 | `mode=agent_run` + `cache_write_token` | 成功后 `POST /results` |

缓存键：`report_code` + canonical params 的 SHA-256。读前仍校验 ACL 与参数 `accepts`。

百炼调用：`POST {base-url}/api/v1/apps/{workflow_key}/completion`，Header `Authorization: Bearer $MIS_BAILIAN_API_KEY`，可选 `X-DashScope-WorkSpace`。Body `{ "input": { "prompt": "..." }, "parameters": {}, "debug": {} }`，成功取 `output.text`。超时默认 90s。日志只记 appId、耗时、request_id，不打 prompt 全文与 Key。失败返回业务错误，不泄漏上游原文。Copilot **不**再派 `spm-report`。

缺 `workflow_key` 或缺 `MIS_BAILIAN_API_KEY`：参数校验错误。

## 硬派发（非百炼）

FE 发会话消息时带：

```json
{ "ai_report_run": { "agent_id": "spm-report", "skill_id": "...", "report_code": "..." } }
```

ai-platform 跳过选人 LLM，直接 `agent__invoke`；有 `skill_id` 时注入 `format_router_skill_hint`（成文 Skill ≠ router）。

## API

- `POST /api/v1/ai-reports/execute`
- `POST /api/v1/ai-reports/results`（`content_md` + `cache_write_token`；百炼同步路径不经过此接口）

权限：与 catalog/execute 同绑 `ai-report:view` / 问数旗舰页（V166：`93232`）。
