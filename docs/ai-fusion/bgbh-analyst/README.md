# 百购分析智能体

> Worker `bgbh-analyst`。协调器 `mis-copilot` 把百购经营、会员、品牌、流失、客流、私域类问题派到这里；其他域的通用问数仍走 `mis-iqd`。
> 规划原文快照在 [planning/](planning/)，来源目录 `D:\project\AI数据分析\百购问数上线`（2026-10-17 拷入）。落地以本页和仓库配置为准。

## 阅读顺序

| 顺序 | 文档 | 说明 |
|------|------|------|
| 1 | 本页 | 已落地的智能体、技能、取数和部署 |
| 2 | [评估.md](评估.md) | 2026-10-17 判断和后续推进清单（改状态即可跟踪） |
| 2a | [第一步-枚举与问数范围.md](第一步-枚举与问数范围.md) | 当前在做的第 1 项：问数范围和枚举取值 |
| 3 | [分析回答手册.md](分析回答手册.md) | 分析功能的开发依据：按问题类型决定写到哪一层 |
| 4 | [分析能力拆解.md](分析能力拆解.md) | 原因层允许使用的分解和现有表 |
| 5 | [planning/06_智能体协作架构设计.md](planning/06_智能体协作架构设计.md) | 独立 Worker、与知识问答 / 问数的边界 |
| 6 | [planning/07_iqd对接设计.md](planning/07_iqd对接设计.md) | 只经 `iqd__ask` 取数 |
| 7 | [planning/04_Skills触发设计.md](planning/04_Skills触发设计.md) | 路由与 S1–S7 |
| 8 | [planning/05_分阶段上线实施计划.md](planning/05_分阶段上线实施计划.md) | 数据与 in_scope 仍按阶段准备 |
| 9 | [planning/使用指南_从零跑通.md](planning/使用指南_从零跑通.md) | 冒烟与常见误用 |

分析口径、语义建模、样本问题树见 [planning/01](planning/01_百购商场分析体系.md)、[02](planning/02_WrenAI语义规则与建模建议.md)、[03](planning/03_WrenAI样本问题树.md)。技能正文格式见 [planning/skills-readme.md](planning/skills-readme.md)。

## 已落地

| 项 | 值 |
|----|----|
| 智能体 ID | `bgbh-analyst` |
| 显示名 | 百购分析智能体 |
| 角色 | Worker（`INVOKE_AGENT_WHITELIST` 默认包含它） |
| 权限 | `iqd:ask:use` |
| 问数项目 | 项目配置里的名称 `bg-data`（`iqd__ask` / `iqd__describe_scope` 的 `connection_id` 可传项目名或数字 id） |
| 取数工具 | `skill`、`iqd__ask`、`iqd__describe_scope` |

八个技能都已启用，正文在 `agent/ai-platform/configs/skills/packages/bgbh/<skill_id>/SKILL.md`：

| 技能 | 主题 |
|------|------|
| `bgbh-router` | 总控路由 |
| `bgbh-s1-daily-report` | 经营日报 |
| `bgbh-s2-member` | 会员经营 |
| `bgbh-s3-brand-newcust` | 品牌与新客 |
| `bgbh-s4-brand-link` | 品牌关联 |
| `bgbh-s5-member-drain` | 会员流失 |
| `bgbh-s6-flow-parking` | 客流车流 |
| `bgbh-s7-private-domain` | 私域与投入 |

## 代码与配置

- 智能体：`agent/ai-platform/configs/agents/bgbh-analyst/`
- 技能注册：`agent/ai-platform/configs/skills/registry.yaml`
- 协调器委派：`agent/ai-platform/configs/agents/mis-copilot/coordination.yaml`
- 协调器分流说明：`agent/ai-platform/configs/agents/mis-copilot/runtime/prompts/system.md`
- 项目名解析：`agent/ai-platform/backend/src/agent/mis_iqd/scope_resolver.py`（`ScopeResolver._pick_connection`）
- 工具入参：`agent/ai-platform/backend/src/agent/mis_iqd/tools.py`

项目名匹配不到，或同名已启用项目不止一条，问数返回 45201，不改查其他连接。纯数字仍按连接 id。未传 `connection_id` 时仍落到当前已启用的第一条连接。

## 部署

只更新 26.33 的 `ai-platform-backend` 后执行 `systemctl restart ai-platform-backend`。配置目录是 `/usr/local/app/ai-platform-backend/agent/ai-platform/configs`。若环境变量单独写了 `INVOKE_AGENT_WHITELIST`，把 `bgbh-analyst` 加进去。问数项目 `bg-data` 需保持启用且 MCP 在跑。

本目录是文档，不需要单独部署。
