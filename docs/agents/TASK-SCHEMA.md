# TASK / DEF 字段字典

与 [大型项目cursor方案.md](./大型项目cursor方案.md) §4 一致。章节标题固定，可空不可删。

## Front-matter

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | `TASK-yyyyMMdd-seq` 或 `DEF-yyyyMMdd-seq` |
| `title` | string | 短标题 |
| `status` | enum | `inbox` \| `active` \| `blocked` \| `done` |
| `assignee` | enum | `none` \| `PM` \| `DEV` \| `DEV-FE` \| `DEV-BE` \| `QA` \| `OPS` |
| `priority` | enum | `P0` \| `P1` \| `P2` |
| `scope` | string[] | 仓库相对路径，可多选 |
| `needs_ops` | bool | 是否需要 OPS |
| `parent` | string\|null | 子任务 / 缺陷必填父 TASK id |
| `refs` | string[] | 仓库内路径；禁止贴长文 |
| `acceptance` | object[] | `{ id, text, done }`；关闭前全勾或 Decision Log waiver |
| `created_at` | ISO8601 | 创建时间 |
| `claimed_at` | ISO8601\|null | 领取时间 |
| `updated_at` | ISO8601 | 最后更新 |
| `blocked_reason` | string\|null | 阻塞原因 |
| `locks` | string[] | 路径锁；与 `active`/`inbox` 其他单不得交集 |

## 正文章节（固定）

1. Goal  
2. Out of scope  
3. Constraints  
4. Plan  
5. DEV Log（只追加摘要）  
6. QA Log  
7. OPS Log（仅 `needs_ops`）  
8. Decision Log  

## 文件名

- 工单：`TASK-{yyyyMMdd}-{seq}-{slug}.md`（例：`TASK-20260825-001-agent-team-bootstrap.md`）  
- 缺陷：`DEF-{yyyyMMdd}-{seq}-{parentTaskSeq}-{slug}.md`  

状态靠**目录移动**，不改文件名传状态。

## 模板（复制新建）

```markdown
---
id: TASK-YYYYMMDD-SEQ
title: short-title
status: inbox
assignee: none
priority: P1
scope:
  - frontend/mis-admin-web
needs_ops: false
parent: null
refs: []
acceptance:
  - id: A1
    text: ...
    done: false
created_at: YYYY-MM-DDTHH:mm:ss+08:00
claimed_at: null
updated_at: YYYY-MM-DDTHH:mm:ss+08:00
blocked_reason: null
locks: []
---

## 1. Goal


## 2. Out of scope


## 3. Constraints


## 4. Plan


## 5. DEV Log


## 6. QA Log


## 7. OPS Log


## 8. Decision Log

```
