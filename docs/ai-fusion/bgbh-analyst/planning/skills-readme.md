# Skills 说明（SKILL.md 标准格式）

> **不知道怎么用？先看《使用指南_从零跑通.md》**：三种接入方式、Phase 1 最小闭环清单、8 条冒烟测试、常见误用。

## 目录结构（符合 SKILL.md 规范）

```
skills/
├── bgbh-router/SKILL.md              # 总控路由
├── bgbh-s1-daily-report/SKILL.md     # S1 经营日报
├── bgbh-s2-member/SKILL.md           # S2 会员经营
├── bgbh-s3-brand-newcust/SKILL.md    # S3 品牌与新客
├── bgbh-s4-brand-link/SKILL.md       # S4 品牌关联
├── bgbh-s5-member-drain/SKILL.md     # S5 会员流失
├── bgbh-s6-flow-parking/SKILL.md     # S6 客流车流
├── bgbh-s7-private-domain/SKILL.md   # S7 私域与投入产出
├── README.md / 使用指南_从零跑通.md  # 说明文档（不是 skill）
└── _旧格式存档/                       # 早期平铺版，已废弃
```

## 格式规范（OpenHarness / package 范式）

> 范式来源：`agent/ai-platform/configs/skills/packages/iqd/business-analysis/SKILL.md`
> （纯文档型 package skill，与百购同形态：不挂 MCP handler，靠正文指导 LLM 调 `iqd__ask`）。

每个 skill = `<skill_id>/SKILL.md`，**目录名必须等于 `skill_id`**（OpenHarness 用父目录名作
`Available Skills` 的粗体主名）。frontmatter 字段：

```yaml
---
name: bgbh-s5-member-drain                 # 必需；与 skill_id、目录名三者一致
skill_id: bgbh-s5-member-drain             # 必需！详见下方警告
description: 百购商场会员流失分析取数。当用户询问……时使用。触发词包括：流失、沉睡……  # 必需，唯一触发机制
version: "1.0.0"
category: department_store                 # 参与检索打分，见下方更正
tags:
  - 百购
  - 问数
  - 会员流失
  - bgbh-s5-member-drain                   # 惯例：末位放自身 skill_id
source: package                            # 必需！package 才能进 OH 视图，见「部署位置」
status: active
timeout: 120                               # 问数链路较慢，对齐 business-analysis
requires_approval: false
required_permissions:
  - iqd:ask:use                            # 取数功能码，缺则在 Skill 层被拦
---
```

**package 范式不含** `handler` / `parameters` / `priority` / `agent_created` —— 那是 custom 路径的字段，
本组已按 package 规范移除。

> ### 🔴 警告：`skill_id` 缺失 = 技能静默失效
> 平台加载器的判定是 `if not metadata or not metadata.get("skill_id"): 跳过该文件`
> （`custom_store.py` L133，只打一条 warning 日志）。
> **没有 `skill_id` 的 SKILL.md 不会报错，只是永远不生效** —— 典型的"看起来部署了、实际没跑"。
> 部署后请用技能列表接口核对技能确实已注册，别只看文件在不在。
>
> ### ✅ 更正（前版写错，以此为准）
> 前一版说「`category` 必须取自枚举，传非法值会报错」——**这个说法是错的**。
> `models.py` L61 的声明是 `category: str = SkillCategory.BUILT_IN`，**类型是 `str` 而非枚举**，
> 因此任意字符串都合法（现网 `business-analysis` 用的就是 `category: iqd`，不在枚举内）。
> `category` 的真实作用是**参与检索综合分**（`category_match` 权重 0.15，见 `models.py` L174/L182），
> 所以选一个有业务语义的值利于召回——百购百货业态用 `department_store`。

**关键认知**：`description` 是**唯一的触发机制**——系统靠它判断"这个问题该不该加载本 skill"。
因此触发词必须写进 description（已全部写进），正文里的"触发与槽位"小节是给模型执行时看的约束。

> ⚠️ 早期版本自定义的 `triggers` / `slots` / `whitelist` / `title` / `version` 字段不在 WorkBuddy 规范内，
> 已全部降级为正文的「触发与槽位」「依赖表」小节。**不要再加回 frontmatter**
> （注意：`version` 在**平台**规范里是合法字段，与此处说的是两回事——平台字段见上一节清单）。

## 部署位置（MIS 平台）

本组 Skill 部署在 **百购分析智能体（Worker）** 下，取数走 `iqd__ask` 工具，**不直连 WrenAI**：

```
百购 Worker → iqd__ask 工具 → iqd 编排层 → WrenAI → Doris
```

| 环节 | 位置 | 说明 |
|------|------|------|
| **技能正文（关键）** | `agent/ai-platform/configs/skills/packages/bgbh/<skill_id>/SKILL.md` | **必须是 package，不能只放 custom 目录**，原因见下方🔴 |
| 技能启用登记 | `configs/agents/<百购智能体>/skills/enabled-skills.yaml` 的 `skills.enabled` 列表 | 按智能体隔离——正文是全局的，启用是按 agent 的 |
| 工具授权 | 该智能体的 `identity/skill-permissions.yaml` + `identity/access-control.yaml` | 需含 `iqd:ask:use`；frontmatter 已声明 `required_permissions` |
| 协调者登记 | `configs/agents/mis-copilot/coordination.yaml` 的 `worker_ids` | 新增智能体后必须登记，否则 Coordinator 派不到它 |

> ### 🔴 为什么必须放 `packages/` 而不是 `data/skills/`
>
> OpenHarness 的技能视图由 `oh_runtime_builder.materialize_oh_skill_view` 物化，
> 它 **只扫描 `configs/skills/packages/`**（`_find_package_skill_mds` 对 packages 目录 rglob），
> **不扫描 custom 落盘目录 `data/skills/`**。
>
> 后果：注册成 custom skill 的百购技能，其 `skill_id` 虽然会进 `enabled_package_skill_ids`，
> 但在 packages 里找不到对应 SKILL.md → **不会物化进 OH 视图** →
> OpenHarness 的 `Available Skills` 里看不到 → **无法通过 `skill` 工具加载**。
> 症状是"技能注册了、授权也有了，但模型永远不触发"。
>
> 因此：百购 8 个技能放 `configs/skills/packages/bgbh/<skill_id>/SKILL.md`（新建 `bgbh` 域目录，
> 与既有 `crm` / `iqd` / `_shared` 并列），`source: package`。
>
> ### 关于 OH 的目录名
> OpenHarness 期望 `<extra_skill_dir>/<skill-name>/SKILL.md`，且用**父目录名作 `command_name`（粗体主名）**。
> 旧实现曾把整类 `packages/crm` 塞进去导致主名被模型缩写（`member` 而非 `member-points-account`）。
> 百购的目录名严格等于 `skill_id`（如 `bgbh-s1-daily-report`），不会出现该问题。

**验证方式**：部署后看 `configs/.runtime/oh-skills/<百购智能体>/` 下是否出现
`bgbh-router/`、`bgbh-s1-daily-report/` 等目录（每个内含指向真实 SKILL.md 的链接或副本）。
**没有出现 = 没进 OH 视图，技能不会被触发。**

## 启用顺序

```
Phase 1: 00(router) + S1
Phase 2: + S2、S5
Phase 3: + S3、S4
Phase 4: + S6、S7
```

> package 范式无 `priority` 字段（那是 custom 路径的）。router 的优先性靠
> **Phase 1 首个启用** + 其 `description` 覆盖全部触发词来保证，不依赖排序字段。

## 与 iqd 平台配置的对应关系（原「WrenAI 侧」已重构）

本组 Skill **不再直接对应 WrenAI 控制台**，中间隔了一层 iqd。对应关系变为：

| Skill 侧 | iqd 侧落点 | WrenAI 侧（由 iqd 转交） | 同步要求 |
|----------|-----------|------------------------|----------|
| 依赖表清单（原「表白名单」） | `iqd_catalog_item.in_scope` + `iqd_scope_policy` | 已注册建模表 | 扩 Skill 时**先**在 iqd 勾选 in_scope，**再**启用 Skill，顺序不可颠倒 |
| 全局指令（router 第 8 节） | `iqd_knowledge`（kind=instructions） | Instructions | 真源在 `iqd_knowledge`，Skill 内为对照副本，两边必须一致 |
| 口径路由 / 术语表 | `iqd_knowledge`（kind=term / metric） | Business Terms | 同名术语一处维护 |
| 问句改写模板 | `iqd_sql_pair`（树形分类 `iqd_sql_pair_category`） | Question-SQL Pairs | 每个🌟样本对应至少 2 种问法变体 |

**职责分工（不要再想着自己干）**：

- Skill 层**拿不到 SQL**（`view=user` 下 iqd 的 `ResponseProjector` 已删除 `sql`/`sql_dialect` 键），
  因此**不做也不该做** SQL 白名单校验——越表拦截由 iqd 侧 in_scope + 表级 ACL 硬执行（fail-closed）。
- Skill 层的核心产出是**规范问句**：补全槽位、术语规范化、组装 `【S#】` 前缀，**不改变语义**。
- Skill 层**不得委派任何智能体**（Worker `max_depth=1`），需要知识背景时由 Coordinator 经 TaskBrief 注入。

## 变更纪律

- 新增表/改口径：先改《02_语义规则》→ 再改对应 Skill 文件 → 最后在 iqd 管理面更新并同步 WrenAI，
  顺序不可颠倒。
- **双向同步检查点**：`iqd_knowledge`（Instructions/术语）与本文件 router 第 8 节副本、各 Skill
  口径路由表必须一致；不一致时**以 `iqd_knowledge` 为准**并立即回头改 Skill。
- 每次变更记版本号（frontmatter `version` +1），未命中日志按 version 归因。
- 改动本组 Skill 前，先确认是否触碰了硬约束清单（见 `bgbh-router` §0），六条约束任一被破坏都要说明理由。
