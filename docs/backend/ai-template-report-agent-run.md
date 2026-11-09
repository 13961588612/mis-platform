# 模板报告 · 智能体成文与缓存

## 职责

| 组件 | 职责 |
|------|------|
| mis-ai-template-report | ACL、槽位校验、提示词渲染、成文缓存读写、下发 `agent_run` / `cached` |
| AdminWeb CopilotPanel | 参数卡「重新生成」；命中缓存直接展示；未命中硬派发 + 回写 |
| ai-platform Worker | 取数/工具/成文；`metadata.ai_report_run` 强制 agent + 可选 skill |

## 报告定义字段

- `use_ai_workflow`：启用智能体成文
- `target_agent_id`：硬派发 Worker（必填）
- `target_skill_id`：可选，成文 Skill（日报 `sm-shop-ops-diary-report`、周报 `week-report`、月报 `month-report`）。**不是** router；槽位不齐才先加载 `sm-report-router`
- `prompt_template`：任务消息模板（`{{wire_key}}`）
- `cache_ttl_hours`：缓存 TTL，默认 24

## execute

请求：`reportCode`、`params`、`regenerate`（参数卡「重新生成」）。

| regenerate | 读缓存 | 响应 | 写缓存 |
|------------|--------|------|--------|
| false | 是，命中 → `mode=cached` | 直接 `content_md` | 否 |
| false 未命中 / true | 否或未命中 | `mode=agent_run` + `cache_write_token` | 成功后 `POST /results` |

缓存键：`report_code` + canonical params 的 SHA-256。读前仍校验 ACL 与参数 `accepts`。

## 硬派发

FE 发会话消息时带：

```json
{ "ai_report_run": { "agent_id": "spm-report", "skill_id": "...", "report_code": "..." } }
```

ai-platform 跳过选人 LLM，直接 `agent__invoke`；有 `skill_id` 时注入 `format_router_skill_hint`（成文 Skill ≠ router）。

## API

- `POST /api/v1/ai-reports/execute`
- `POST /api/v1/ai-reports/results`（`content_md` + `cache_write_token`）

权限：与 catalog/execute 同绑 `ai-report:view` / 问数旗舰页（V166：`93232`）。
