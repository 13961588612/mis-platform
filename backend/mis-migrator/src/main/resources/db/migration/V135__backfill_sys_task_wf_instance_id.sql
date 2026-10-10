-- V135__backfill_sys_task_wf_instance_id.sql
-- 回填 sys_task.metadata.wfInstanceId（数据修复，非 schema 变更）| PostgreSQL 16 | 幂等：可重复执行。
--
-- ===========================================================================
-- 1) 为什么需要这条回填（Bug 现象 → 根因）
-- ---------------------------------------------------------------------------
-- 门户 `/portal` 首页「我的待办」板块（frontend/mis-admin-web/src/features/portal/
-- components/task-board.tsx）点某一行时，本应打开右侧「待办详情抽屉」，实际却
-- **跳转到了工作台/待办列表页 `/task/pending`**。
--
-- 前端判断链（src/lib/api/wf-instance.ts::wfInstanceId）：
--     const parsed = JSON.parse(item.metadata) as { wfInstanceId?: number | string };
--     return parsed.wfInstanceId != null ? String(parsed.wfInstanceId) : null;
-- 抽屉打开的前置条件就是 `wfInstanceId(item)` 非空；为空时 `open()` 走**降级分支**
-- `navigate('/task/pending')` —— 用户撞到的就是这个分支。
--
-- 为什么「真实流程创建的任务」不会有这个问题：
--   backend/mis-taskflow/.../service/ProcessService.java 建 sys_task 时，metadata 写入的是
--     "{\"wfInstanceId\":" + instance.getId() + ",\"wfNode\":\"" + node.getNodeCode() + "\"}"
--   —— 运行时创建的任务**天然带 wfInstanceId**。
--
-- 为什么「演示数据」会撞：
--   V129__taskflow_purchase_demo_instances.sql 造的 sys_task（id 960121 / 960122 /
--   960123 / 960124）metadata 是
--     jsonb_build_object('demoSeed','V129','scenario', ...)
--   —— **没有 wfInstanceId**，于是 wfInstanceId() 返回 null，点行必然降级跳转。
--
-- ===========================================================================
-- 2) 数据来源：wf_task 反查（关联关系在库里已经存在）
-- ---------------------------------------------------------------------------
-- 无需新建关联，`wf_task` 侧两条链路本来就都维护：
--   * V129 §5 已回填 `wf_task.sys_task_id`（例：wf_task.id=960113 → sys_task_id=960122）；
--   * 运行时 `ProcessService` 同时 `wfTask.setSysTaskId(sysTaskId)` 与
--     `wfTask.setInstanceId(instance.getId())`；
--   * `wf_task.instance_id` 本身即 `wf_instance.id`（V121 建表即 NOT NULL 外键）。
-- 故可用 **等值 JOIN `wf_task.sys_task_id = sys_task.id`** 精确反查实例 id 回填。
--
-- ===========================================================================
-- 3) 为什么必须写成单条 UPDATE ... FROM（等值 JOIN），不能写成两个 IN 子查询
-- ---------------------------------------------------------------------------
-- ⚠️ 本仓库已有多表 UPDATE 笛卡尔积事故：V129 §5 的注释明确记录了
--   「一个 UPDATE 会把**所有** wf_task 都绑到同一个 sys_task（实测 bind 成 960121）」。
-- 凡是「按两个 IN 列表分别匹配」的多表 UPDATE 都会退化成笛卡尔积。
-- 本文件只用**一个等值 JOIN**（`wt.sys_task_id = t.id`），一对一匹配，天然无笛卡尔积。
--
-- ⚠️ 另一个必须知道的性质：`wf_task.sys_task_id` **不是唯一键**——一个 sys_task 可能被同一
-- 实例的多个 wf_task 节点共享（如实例 960102 的 start/approve 两个节点都指向 960122）。
-- PG 的 `UPDATE ... FROM` 在多行匹配时取任意一行；此处同一 sys_task 的各匹配行
-- `instance_id` **必然相同**（都指向同一个 wf_instance），故结果唯一、可重复执行。
-- 文件末尾附了自检查询用于验证该不变式。
--
-- ===========================================================================
-- 4) 影响范围与安全约束
-- ---------------------------------------------------------------------------
--   * **只补缺的**：`AND NOT (COALESCE(t.metadata,'{}'::jsonb) ? 'wfInstanceId')`
--     —— 运行时新建的任务已有该字段（且常带 `wfNode`），覆盖会丢信息，绝不能覆写。
--   * **只回填有实例的**：`wt.instance_id IS NOT NULL`。
--   * **排除软删**：`t.deleted = 0`（sys_task.deleted SMALLINT NOT NULL DEFAULT 0，
--     语义见 V120 建表 + SysTask 实体 `@SQLRestriction("deleted = 0")`）。
--   * **合并不覆盖**：`COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(...)`，
--     `||` 是 jsonb 合并操作符，保留原有其它 key（demoSeed / scenario 等）。
--   * **类型与运行时一致**：运行时写的是**裸数字**（`instance.getId()` 无引号），
--     这里用 `wt.instance_id`（BIGINT）构造，同样落**JSON number**，不自创字符串格式。
--     前端 `String(parsed.wfInstanceId)` 对 number/string 都吃，保持一致更利于排查。
--   * `updated_at` **不动**：本条是数据补齐而非业务状态变更，改时间戳会让
--     「最近更新」排序产生无意义的抖动。
--   * 前端**无需改动**：`task-board.tsx` 的降级分支（无实例时跳 `/task/pending`）
--     保留——真正没有关联流程的纯系统任务仍需要这个兜底。
-- ===========================================================================

UPDATE sys_task t
SET metadata = COALESCE(t.metadata, '{}'::jsonb)
                || jsonb_build_object('wfInstanceId', wt.instance_id)
FROM wf_task wt
WHERE wt.sys_task_id = t.id
  AND wt.tenant_id = t.tenant_id
  AND wt.instance_id IS NOT NULL
  AND t.deleted = 0
  AND NOT (COALESCE(t.metadata, '{}'::jsonb) ? 'wfInstanceId');

-- ---------------------------------------------------------------------------
-- 自检（供手工执行核对，迁移本身不依赖）
--
-- 1) 演示任务已带上实例 id，且原有 demoSeed/scenario 未丢：
-- SELECT id, status, metadata FROM sys_task WHERE id IN (960121,960122,960123,960124) ORDER BY id;
--
-- 2) 计数（回填后 >= 4；V135 之前为 0）：
-- SELECT count(*) FROM sys_task WHERE metadata ? 'wfInstanceId';
--
-- 3) 确认没有误伤运行时任务（这些本就有 wfInstanceId + wfNode，应完全不变）：
-- SELECT id, metadata FROM sys_task WHERE metadata ? 'wfNode' ORDER BY id DESC LIMIT 10;
--
-- 4) 验证「同一 sys_task 的多个 wf_task 行 instance_id 一致」这一不变式（应返回 0 行）：
-- SELECT wt.sys_task_id, count(DISTINCT wt.instance_id)
--   FROM wf_task wt WHERE wt.sys_task_id IS NOT NULL
--  GROUP BY wt.sys_task_id HAVING count(DISTINCT wt.instance_id) > 1;
-- ---------------------------------------------------------------------------