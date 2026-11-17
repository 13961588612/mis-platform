# mis-extract 技能

本 Agent 专用于业务表单辅助录入。填单页直连本 Agent 开会话（不经 Copilot 委派）。

| skill_id | 包路径 | 用途 |
|----------|--------|------|
| `form-assist` | `configs/skills/packages/form/form-assist/SKILL.md` | 按表单 `fields[].key` 抽 JSON |

新表单技能：在 `packages/form/` 新增包，再把 `skill_id` 追加进 `enabled-skills.yaml`，并登记 `ai:skill:{id}:run`。
