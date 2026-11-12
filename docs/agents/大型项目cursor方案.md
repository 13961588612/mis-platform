# 大型项目 Cursor 方案

> 状态：定稿  
> 适用：MIS Platform 等大型 monorepo  
> 目标：用多窗口 Cursor Agent 模拟软件团队，可并行、可追溯、不污染业务文档

---

## 0. 目标与原则

**目标**：用多窗口 Cursor Agent 模拟软件团队，在大型 monorepo 中可并行、可追溯、不污染业务文档。

**硬原则**：

1. **工作单元 = 任务（Task）**，不是角色日记。
2. **活跃任务集必须小**：Agent 与人只看 `inbox/` + `active/`。
3. **完成后必须归档**：离开活跃目录即视为关闭。
4. **一人只对 PM**：需求变更只进 PM；DEV/QA 不得直接接口头新需求。
5. **业务权威仍在 `docs/`**：任务文件只承载工单与回执，不替代 PRD/ADR。
6. **一次对话只扮演一个角色**；每个窗口绑定一个角色规则。

---

## 1. 角色编制（固定 4 席）

| 席位 | 窗口名 | 本仓库职责映射 | 允许写什么 | 禁止做什么 |
|------|--------|----------------|------------|------------|
| **PM** | `agent-pm` | Product（跨服务时顺带写清 Architect 约束指针） | `docs/agents/tasks/**` 工单；必要时引用既有 PRD/ADR 路径 | 改业务代码；改 Flyway；擅自改已确认决策 |
| **DEV** | `agent-dev` | Backend / Frontend / Agent-Python（按工单 `scope` 字段） | 业务代码 + 对应单测；工单内「DEV 回执」节 | 改验收标准；扩 scope；commit/push（除非工单显式授权） |
| **QA** | `agent-qa` | Reviewer + 测试执行 | 跑测试；工单内「QA 结果」节；缺陷回派文件 | 为「修 bug」直接改产品逻辑（缺陷必须回派 DEV） |
| **OPS** | `agent-ops` | DevOps | 仅当工单 `needs_ops: true` 时处理部署/配置相关；写 OPS 回执 | 无工单时主动改 `deploy/` |

大型项目固定这 4 个窗口。前端/后端差异用工单字段 `scope` 区分，**不再为每个技术栈另开常驻窗口**（避免窗口爆炸）。同一时刻若必须前后端并行，开**临时**第二个 DEV 窗口，工单 `assignee` 写成 `DEV-FE` / `DEV-BE`，完成后关闭临时窗。

---

## 2. 目录结构（唯一）

仓库根下固定：

```text
docs/agents/
  README.md                 # 本规范摘要 + 开窗话术（人读）
  TASK-SCHEMA.md            # 工单字段字典（机器/人共用）
  大型项目cursor方案.md      # 本定稿全文
  tasks/
    inbox/                  # 待领取（仅 PM 创建；DEV/QA/OPS 只读领取）
    active/                 # 进行中（持有者更新）
    blocked/                # 阻塞（需人决策）
    done/
      YYYY/
        MM/                 # 归档；默认不扫描
  defects/
    open/                   # QA 开的缺陷单（仍是一单一文）
    done/
      YYYY/MM/
```

**禁止**：

- 在 `docs/prd/`、`docs/adr/`、业务代码旁堆角色流水账。
- 使用「每个角色一个永远追加的总文件」。
- 把历史工单留在 `inbox/` 或 `active/`。

---

## 3. 命名与状态机（唯一）

### 3.1 工单文件名

```text
TASK-{yyyyMMdd}-{seq}-{slug}.md
```

例：`TASK-20260814-003-kb-feedback-filter.md`

- `seq`：当日三位数，由 PM 分配，全局在当日唯一。
- `slug`：短横线英文，稳定后不改名（状态靠**目录移动**，不靠改文件名传状态）。

### 3.2 缺陷文件名

```text
DEF-{yyyyMMdd}-{seq}-{parentTaskSeq}-{slug}.md
```

例：`DEF-20260814-001-003-export-npe.md`（父任务 seq=003）

### 3.3 状态机

```text
inbox → active → done/YYYY/MM
              ↘ blocked → active → done/YYYY/MM
```

缺陷：

```text
defects/open →（DEV 修复并回执）→ QA 复验 → defects/done/YYYY/MM
```

**移动规则**：

| 动作 | 谁执行 | 从 → 到 |
|------|--------|---------|
| 创建工单 | PM | 新建于 `inbox/` |
| 领取 | DEV/QA/OPS | `inbox/` → `active/`，并写入 `assignee`、`claimed_at` |
| 阻塞 | 持有者 | `active/` → `blocked/`，写清 `blocked_reason` 与待人决策点 |
| 解除阻塞 | PM（人确认后） | `blocked/` → `active/` |
| 关闭 | QA 判定通过后由 QA 执行；纯文档且无代码的单由 PM 关闭 | `active/` → `done/YYYY/MM/` |
| 开缺陷 | QA | 新建于 `defects/open/`，`parent` 指向父工单路径 |
| 关缺陷 | QA 复验通过 | `defects/open/` → `defects/done/YYYY/MM/` |

---

## 4. 工单文件内容（唯一模板）

每个 `TASK-*.md` **必须**且**仅**使用下列结构。章节可空，但标题不可删、不可另起自由章节名。

```markdown
---
id: TASK-20260814-003
title: kb feedback filter
status: inbox          # inbox|active|blocked|done
assignee: none         # none|PM|DEV|DEV-FE|DEV-BE|QA|OPS
priority: P1           # P0|P1|P2
scope:                 # 可多选
  - frontend/mis-admin-web
  - backend/mis-kb
needs_ops: false
parent: null           # 子任务时填父 TASK id
refs:                  # 只写仓库内路径，禁止贴长文
  - docs/prd/xxx.md
  - docs/adr/ADR-xxx.md
acceptance:            # 可勾选；关闭前必须全勾或明示 waivers
  - id: A1
    text: ...
    done: false
created_at: 2026-08-14T10:00:00+08:00
claimed_at: null
updated_at: 2026-08-14T10:00:00+08:00
blocked_reason: null
locks:                 # 路径锁；与 active/inbox 中其他单不得交集
  - backend/mis-kb/**
---

## 1. Goal
（≤10 行：要解决什么、给谁用）

## 2. Out of scope
（明确不做）

## 3. Constraints
（权限码/Flyway/不 commit 等；只写约束，不写教程）

## 4. Plan
（PM 拆的步骤列表；DEV 可勾选进度，不另写第二份计划）

## 5. DEV Log
（仅追加短条目：时间 | 改动摘要 | 验证命令 | 结果）
（单条 ≤5 行；禁止粘贴大段代码——代码在 git diff）

## 6. QA Log
（仅追加：时间 | 测了什么 | pass/fail | 证据路径或命令）

## 7. OPS Log
（仅 needs_ops 时使用）

## 8. Decision Log
（仅记录需人确认的决策与结论；一条一事）
```

**内容膨胀控制（强制）**：

- `Goal` / `Out of scope` / `Constraints`：**改写更新**，不无限追加。
- `DEV/QA/OPS Log`：**只追加摘要行**；单任务日志合计建议不超过 **80 行**；超了先归档细节到 `done` 后的附注，活跃期只保留最近结论。
- 长设计进 `docs/design/` 或 ADR；工单 `refs` 只留链接。
- 禁止把 PRD 全文复制进工单。

缺陷单 `DEF-*.md` 结构相同，但 `parent` 必填，且 `acceptance` 为复现与通过条件。

---

## 5. 窗口与规则绑定（唯一）

### 5.1 Cursor 规则文件

```text
.cursor/rules/
  agent-team-pm.mdc      # alwaysApply: false；仅 PM 窗口手动启用
  agent-team-dev.mdc
  agent-team-qa.mdc
  agent-team-ops.mdc
```

现有 `agent-roles-workflow.mdc`（全局项目规范）**保留 alwaysApply**，作为全员底线；团队四席规则**额外**约束「只动 tasks、状态机、禁止串戏」。

每个 `agent-team-*.mdc` 必须写死：

1. 自己的席位名与允许目录。
2. 只扫描 `docs/agents/tasks/inbox|active|blocked` 与 `docs/agents/defects/open`。
3. **禁止**读取/改写 `docs/agents/tasks/done/**`（除非工单明确要求审计）。
4. 状态只能按第 3.3 节移动。
5. 发现 scope 外改动需求 → 写 `blocked` 或开缺陷，不自行扩大。

### 5.2 开窗标准话术（每个窗口第一条消息固定）

**PM**：`你是 agent-pm。严格遵守 agent-team-pm 与仓库规范。只管理 docs/agents/tasks 与缺陷分流。不改业务代码。`

**DEV**：`你是 agent-dev。只领取 assignee 匹配的工单。实现后更新 DEV Log 与 acceptance 自检，再移交 QA（改 assignee=QA，保持在 active）。`

**QA**：`你是 agent-qa。只做验证与缺陷单。通过则归档到 done/YYYY/MM；失败则开 DEF 并回派 DEV。`

**OPS**：`你是 agent-ops。仅处理 needs_ops:true 且 assignee=OPS 的单。`

---

## 6. 端到端流程（唯一）

```text
人 → 只对 PM 下需求
  PM → 查 docs/ 与代码边界 → 写 1..N 张 TASK 到 inbox/
  DEV → 领单 inbox→active → 实现 → 更新 Log/acceptance 自检
       → assignee=QA（文件仍在 active）
  QA → 验证
       ├─ pass → 移入 done/YYYY/MM/，status=done
       └─ fail → 开 DEF-*-open → assignee=DEV
            DEV 修 → QA 复验 → DEF 归档
  若 needs_ops → QA pass 后 assignee=OPS → OPS 完成 → 再回 QA 做发布相关验收 → 归档
  需人决策 → blocked/，人回复后 PM 解除
```

**并行规则**：

- 同一 `scope` 路径上的两个 DEV 工单：PM 必须串行化或拆成无冲突路径；禁止两窗同时改同一模块无锁。
- 冲突以路径锁字段表达：工单 front-matter 的 `locks`。
- PM 创建时检查：`active/` + `inbox/` 中不得有 `locks` 交集；有交集则后单不得进 `inbox/`，或标 `blocked` 并写依赖。

---

## 7. 人的职责（唯一检查表）

每天（或每个需求批次）只做：

1. 给 PM 提目标与优先级。
2. 看 `blocked/` 并决策（写回 Decision Log 结论）。
3. 抽查 `done/` 最新归档的 acceptance 与 git diff。
4. 需要入库时由人显式要求 commit（符合仓库 Git 规范）。

人不直接向 DEV/QA 加需求；要加需求 → 只找 PM → 新 TASK 或改未领取单。

---

## 8. 与大型项目文档体系的边界

| 内容 | 落点 |
|------|------|
| 产品决策、用户故事定稿 | `docs/prd/`、`docs/project/decisions.md` |
| 架构决策 | `docs/adr/` |
| 设计说明 | `docs/design/` |
| 执行工单与回执 | **仅** `docs/agents/tasks` / `docs/agents/defects` |
| API/表/权限真相 | 既有 `docs/api`、`docs/database`、`docs/api/permissions.md` —— 工单只引用 |

PM 发现文档缺失：先 `blocked` 等人补文档或确认「允许按现有代码推断」，禁止在工单里发明权限码/表结构。

---

## 9. 扫描与「自治」级别（定稿）

**大型项目采用半自动值班，不定制 UI 巡检机器人。**

| 角色 | 值班动作 |
|------|----------|
| PM | 人下达后立即拆单；定期（会话内）检查 `blocked/` |
| DEV/QA/OPS | 会话开始时扫描 `inbox/` + `active/` + `defects/open`；处理匹配单；空闲则回复「无单」并等待人触发下一轮「请值班扫描」 |

原因：大型 monorepo 全自动点选 Cursor 窗口误操作成本高；文件协议已足够协作，巡检脚本列为明确不做项。

---

## 10. 完成定义（DoD，全员同一套）

一张 TASK 可归档，当且仅当：

1. `acceptance` 全部 `done: true`，或 `Decision Log` 中有人签核的 waiver。
2. 关联 `DEF` 全部在 `defects/done/`。
3. `needs_ops: true` 时 OPS Log 有完成记录且 QA 已复验。
4. 文件已从 `active/` 移至 `done/YYYY/MM/`，`status: done`。
5. 未违反仓库硬约束（权限、Flyway 只追加、无密钥、未擅自 commit）。

---

## 11. 落地清单

按序做完即齐：

1. 创建第 2 节目录与空的 `done/YYYY/MM`。
2. 写入 `TASK-SCHEMA.md`（字段字典 = 第 4 节）。
3. 新增 4 个 `agent-team-*.mdc`。
4. `docs/agents/README.md` 写入第 5.2 开窗话术 + 第 6 流程。
5. 开 4 个窗口，各贴话术，启用对应规则。
6. 用一个真实小需求跑通 inbox→active→done，作为样板工单留在 `done/`。

---

## 12. 方案摘要

**4 席位 × 任务生命周期目录 × 单一工单模板 × 路径锁 × 半自动值班 × 业务文档与工单分离。**
