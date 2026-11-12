-- V129__taskflow_purchase_demo_instances.sql
-- 采购审批演示数据：让审批页能看到真实的 wf_instance.form_data
-- PostgreSQL 16
--
-- ## 为什么需要它
--
-- 前三批（表单注册表 / 前端契约 / 审批套壳）单测全绿，但**库里一条像样的流程实例都没有**：
-- 真实库里仅有 2 条 `wf_instance`，且都是联调脚本遗留的残桩（business_id形如
-- `DBG-PO-1791467483` / `FINAL-PO-1791467657`，`form_data` 只有 `{"amount": 80000}`
-- 一个字段）。⇒ 审批页打开只能看到「未在 schema 中声明的字段」折叠区，
-- 8 种字段类型一个都没渲染，**演示效果为零**。
--
-- 本迁移种 4 条覆盖用户最初提的四种状态的实例，并顺带补两处缺件：
--   1. `wf_edge` 里 PURCHASE_APPROVAL_DEMO **一条边都没有**（V124 只建了表，没人种数据）
--      ⇒ 流程图/进度条是空的。本迁移按start→approve→end 补 DEFAULT 边。
--   2. `form_definition` 里**没有 PUR_FORM**（V128 只建表 + 登记菜单/端点，没种表单本身）
--      ⇒ `WfDefinitionService.validateSupportedForms` 会在**编辑** PURCHASE_APPROVAL_DEMO
--      时直接抛「表单「PUR_FORM」未注册或已停用」。本迁移补注册（见 §2 论证）。
--
-- ## 幂等策略（对齐 V128 的三重手法）
--
--   * 建边/建实例：固定 ID + `WHERE NOT EXISTS (同 ID)`
--   * 业务键防重：额外 `AND NOT EXISTS (同 tenant +同 business_id)`
--   * 外键目标前置：`EXISTS (SELECT 1 FROM wf_definition/wf_node WHERE id = ...)`
--   * 全程 `NOW()` 固定表达式，不用 `clock_timestamp()` 之类非确定函数
--
-- 连跑两次结果完全一致（第二次全部命中 NOT EXISTS 而跳过）。
--
-- ⚠️ 绝不修改 V120~V128（checksum 变更会阻塞整条迁移链）。
--
-- ## ID 段位（已核实 V1~V128 全部文件）
--
--   950001/950011-950013 已被 V123 演示定义与节点占用
--   950101-950104 / 950201-950304 / 950401-950406已被 V123 的菜单/端点占用
--   **96xxxx 全段空闲**，本迁移从 960001 起连续取用，不与任何历史迁移冲突。

-- ===========================================================================
-- 1) 补 wf_edge：把 V123 已种但没连线 的演示流程连起来
--    ⚠️ edge_type 取 DEFAULT（不是 CONDITION_YES/NO）——这条流程没有条件分支，
--       REJECT 边留给将来加驳回分支时用。
--    source_node/target_node 存 **node_code**（不是 wf_node.id），见 V124 列注释。
-- ===========================================================================
INSERT INTO wf_edge (id, definition_id, source_node, target_node, edge_type, label, condition_expr, sort_order, created_at)
SELECT v.* FROM (VALUES
  (960001, 950001, 'start',   'approve', 'DEFAULT', '提交', NULL, 0, NOW()),
  (960002, 950001, 'approve', 'end',     'DEFAULT', '通过', NULL, 1, NOW())
) AS v(id, definition_id, source_node, target_node, edge_type, label, condition_expr, sort_order, created_at)
WHERE NOT EXISTS (SELECT 1 FROM wf_edge WHERE id = v.id)
  AND NOT EXISTS (
        SELECT 1 FROM wf_edge e
        WHERE e.definition_id = v.definition_id
          AND e.source_node = v.source_node
          AND e.target_node = v.target_node
          AND e.edge_type   = v.edge_type)
  AND EXISTS (SELECT 1 FROM wf_definition WHERE id = 950001);

-- ===========================================================================
-- 2) 注册 PUR_FORM 到 form_definition
--
-- ## 论证：为什么**必须**种（不是可选）
--
-- `WfDefinitionService.validateSupportedForms`（:210-228）在 create/update 时对
-- `supportedFormCodes` 逐个强校验：必须在 form_definition 里已注册、未软删、status=ENABLED。
-- 而 PURCHASE_APPROVAL_DEMO 的白名单**硬编码**为ARRAY['PUR_FORM']（V123:146，Flyway 不会重跑）。
-- 若不种这一行 ⇒ 管理员在后台点「编辑」这个演示流程，**保存必然失败**，
-- 报「表单「PUR_FORM」未注册或已停用」⇒ 演示流程成了只读死物。
--
-- 另有一处一致性问题：`form_definition.tenant_id` 用 1（默认租户），
-- 而库里现存的那行 E2E_FORM 是 tenant_id=900002（联调用脏数据）⇒
-- 按 tenant=1 查「已启用 code清单」时列表为空，前端表单管理页与后端校验同时看不到任何表单。
--
-- ⚠️ status=ENABLED：DISABLED 会被 listEnabledCodes 过滤掉，等于没注册。
-- ⚠️ 幂等：uk_form_def_tenant_code是 UNIQUE (tenant_id, code)，
--    用 `NOT EXISTS (tenant=1 AND code='PUR_FORM')` 判定，天然挡住重复执行。
-- ===========================================================================
INSERT INTO form_definition (id, tenant_id, parent_id, code, name, description, status, sort_order, config, deleted, created_by, created_at, updated_at)
SELECT 960010, 1, 0, 'PUR_FORM', '采购申请单',
       '演示用采购申请单。对应前端注册表 PUR_FORM（frontend/mis-admin-web/src/features/biz/forms/forms/pur-form.tsx），字段集以该文件的 PUR_FIELDS 为准。',
       'ENABLED', 10,
       jsonb_build_object('entryFile', 'src/features/biz/forms/forms/pur-form.tsx', 'bundle', 'biz-forms'),
       0, 1, NOW(), NOW()
WHERE NOT EXISTS (
        SELECT 1 FROM form_definition
        WHERE tenant_id = 1 AND code = 'PUR_FORM');

-- ===========================================================================
-- 3) 四条演示实例
--
-- ## form_data 的字段集必须与 pur-form.tsx 的 PUR_FIELDS **逐字对齐**
--
-- PUR_FIELDS（8 个字段，覆盖 FormFieldType 全部 8 种类型）：
--   orderNo     text     采购单号
--   supplier    text     供应商
--   amount      number   申请金额（unit=元）
--   applyDate   date     申请日期（YYYY-MM-DD）
--   priority    select   优先级   HIGH/NORMAL/LOW
--   categories  multi    采购品类 HARDWARE/SOFTWARE/SERVICE/LOGISTICS
--   urgent      bool     是否加急（真boolean，非 "true" 串）
--   reason      textarea 申请理由
--
-- ⚠️ **不设 datetime 字段**：`FormFieldType` 有 8 种类型，但 PUR_FIELDS 只用到其中 7 种
--   （datetime 在 PUR_FORM 里没有任何字段用它）。为「凑满 8 种类型」硬塞一个
--   schema 未声明的 key，会被 ReadOnlyForm 归到「未在 schema 中声明的字段」折叠区
--   ——**反而暴露字段名对不上**。宁可少覆盖一种类型，也不污染演示。
--   详见回报给 team-lead 的说明。
--
-- ⚠️ 只读渲染器的值形状要求（对齐 fields/*.tsx 的解析逻辑）：
--   number  必须 JSON number（"80000" 串能兜住但会走 raw 分支的兄弟路径，优先给 number）
--   bool    必须 JSON true/false（parseBoolValue 也能吃 "1"/"yes"，但给真布尔最稳）
--   date    必须 'YYYY-MM-DD' 字符串（DATE_RE 不接受时间戳）
--   multi   必须是 JSON 数组（ReadOnlyMulti 用 toStringList 归一）
--
-- ## 四种状态与 status 组合（严格对齐 TaskflowStatus / WfTask 常量）
--
--  ① 刚发起   wf_instance=RUNNING  wf_task=PENDING   assignee=admin   history=SUBMIT
--  ② 带审批中wf_instance=RUNNING  wf_task=前节点COMPLETED + 当前 PENDING
--  ③ 否决     wf_instance=TERMINATED wf_task=COMPLETED history=REJECT sys_task=REJECTED
--  ④ 已通过   wf_instance=COMPLETED wf_task 全 COMPLETED history=APPROVE sys_task=APPROVED
--
-- ⚠️ tenant_id=1、initiator/assignee=1（admin）—— 让admin 登录后立刻能在
--   「我发起的」和「我的待办」里看到这4 条。admin 的 tenant_id 确实是 1（已核实）。
--
-- ===========================================================================

-- ---------------------------------------------------------------- ① 刚发起
-- 提交后还没人处理：当前停在 approve 节点，等 admin 自己批。
INSERT INTO wf_instance (id, tenant_id, definition_id, definition_code, started_form_code,
                         business_type, business_id, status, initiator_id, initiator_name,
                         current_node_code, form_data, progress, extra_context,
                         post_process_status, completed_at, created_at, updated_at)
SELECT 960101, 1, 950001, 'PURCHASE_APPROVAL_DEMO', 'PUR_FORM',
       'PURCHASE_ORDER', 'PO-DEMO-2601-0001', 'RUNNING', 1, 'admin',
       'approve',
       jsonb_build_object(
         'orderNo',    'PO-2601-0001',
         'supplier',   '东方算力科技有限公司',
         'amount',     128000.50,
         'applyDate',  '2026-01-08',
         'priority',   'HIGH',
         'categories', jsonb_build_array('HARDWARE', 'SOFTWARE'),
         'urgent',     true,
         'reason',     'Q1 扩容 3 台推理服务器与授权续费，等待主管审批'),
       '1/2', jsonb_build_object('demoSeed', 'V129', 'scenario', 'JUST_STARTED'),
       'WAITING', NULL, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM wf_instance WHERE id = 960101)
  AND NOT EXISTS (SELECT 1 FROM wf_instance WHERE tenant_id = 1 AND business_id = 'PO-DEMO-2601-0001')
  AND EXISTS (SELECT 1 FROM wf_definition WHERE id = 950001);

INSERT INTO wf_task (id, tenant_id, instance_id, node_code, node_name, task_type,
                     sys_task_id, assignee_id, assignee_name, status, action_result, completed_at, created_at)
SELECT 960111, 1, 960101, 'approve', '主管审批', 'APPROVE',
       NULL, 1, 'admin', 'PENDING', NULL, NULL, NOW()
WHERE NOT EXISTS (SELECT 1 FROM wf_task WHERE id = 960111)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960101);

-- 同步落一条 sys_task，让「待办」列表页也能看见（wf_task.sys_task_id 回填在 §5）
INSERT INTO sys_task (id, tenant_id, task_type, biz_type, biz_ref_id, biz_title,
                      target_entity, assignee_id, assignee_name, status, priority,
                      metadata, read_flag, completed_at, deleted, created_by, created_at, updated_at)
SELECT 960121, 1, 'PURCHASE_APPROVAL_DEMO', 'PURCHASE_ORDER', 'PO-DEMO-2601-0001',
       '主管审批 · 采购申请 PO-2601-0001', 'wf_task', 1, 'admin', 'PENDING', 3,
       jsonb_build_object('demoSeed', 'V129', 'scenario', 'JUST_STARTED'),
       FALSE, NULL, 0, 1, NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_task WHERE id = 960121)
  AND NOT EXISTS (SELECT 1 FROM sys_task WHERE biz_ref_id = 'PO-DEMO-2601-0001')
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960101);

INSERT INTO wf_history (id, instance_id, node_code, operator_id, operator_name,
                        operation, from_node, to_node, comment, duration_seconds, created_at)
SELECT 960131, 960101, 'start', 1, 'admin', 'SUBMIT', NULL, 'approve',
       '提交采购申请', NULL, NOW()
WHERE NOT EXISTS (SELECT 1 FROM wf_history WHERE id = 960131)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960101);

-- ------------------------------------------------------------ ② 审批进行中
-- 上一节点已办结，当前节点仍在等待 —— 用来展示「多节点 + 部分完成」的进度。
-- 本例start 节点办结、approve 待处理。
INSERT INTO wf_instance (id, tenant_id, definition_id, definition_code, started_form_code,
                         business_type, business_id, status, initiator_id, initiator_name,
                         current_node_code, form_data, progress, extra_context,
                         post_process_status, completed_at, created_at, updated_at)
SELECT 960102, 1, 950001, 'PURCHASE_APPROVAL_DEMO', 'PUR_FORM',
       'PURCHASE_ORDER', 'PO-DEMO-2601-0002', 'RUNNING', 1, 'admin',
       'approve',
       jsonb_build_object(
         'orderNo',    'PO-2601-0002',
         'supplier',   '云启信息系统（上海）有限公司',
         'amount',     45600,
         'applyDate',  '2026-01-09',
         'priority',   'NORMAL',
         'categories', jsonb_build_array('SOFTWARE'),
         'urgent',     false,
         'reason',     '研发环境数据库与中间件正版授权续费，含一年维保'),
       '1/2', jsonb_build_object('demoSeed', 'V129', 'scenario', 'IN_PROGRESS'),
       'WAITING', NULL, NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day'
WHERE NOT EXISTS (SELECT 1 FROM wf_instance WHERE id = 960102)
  AND NOT EXISTS (SELECT 1 FROM wf_instance WHERE tenant_id = 1 AND business_id = 'PO-DEMO-2601-0002')
  AND EXISTS (SELECT 1 FROM wf_definition WHERE id = 950001);

-- start 节点：已完成（走过的节点）
INSERT INTO wf_task (id, tenant_id, instance_id, node_code, node_name, task_type,
                     sys_task_id, assignee_id, assignee_name, status, action_result, completed_at, created_at)
SELECT 960112, 1, 960102, 'start', '提交申请', 'APPROVE',
       NULL, 1, 'admin', 'COMPLETED',
       jsonb_build_object('remark', '已提交'), NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_task WHERE id = 960112)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960102);

-- approve 节点：待处理（当前节点）
INSERT INTO wf_task (id, tenant_id, instance_id, node_code, node_name, task_type,
                     sys_task_id, assignee_id, assignee_name, status, action_result, completed_at, created_at)
SELECT 960113, 1, 960102, 'approve', '主管审批', 'APPROVE',
       NULL, 1, 'admin', 'PENDING', NULL, NULL, NOW() - INTERVAL '2 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_task WHERE id = 960113)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960102);

INSERT INTO sys_task (id, tenant_id, task_type, biz_type, biz_ref_id, biz_title,
                      target_entity, assignee_id, assignee_name, status, priority,
                      metadata, read_flag, completed_at, deleted, created_by, created_at, updated_at)
SELECT 960122, 1, 'PURCHASE_APPROVAL_DEMO', 'PURCHASE_ORDER', 'PO-DEMO-2601-0002',
       '主管审批 · 采购申请 PO-2601-0002', 'wf_task', 1, 'admin', 'PENDING', 2,
       jsonb_build_object('demoSeed', 'V129', 'scenario', 'IN_PROGRESS'),
       FALSE, NULL, 0, 1, NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days'
WHERE NOT EXISTS (SELECT 1 FROM sys_task WHERE id = 960122)
  AND NOT EXISTS (SELECT 1 FROM sys_task WHERE biz_ref_id = 'PO-DEMO-2601-0002')
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960102);

INSERT INTO wf_history (id, instance_id, node_code, operator_id, operator_name,
                        operation, from_node, to_node, comment, duration_seconds, created_at)
SELECT 960132, 960102, 'start', 1, 'admin', 'SUBMIT', NULL, 'approve',
       '提交采购申请', NULL, NOW() - INTERVAL '2 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_history WHERE id = 960132)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960102);

-- ------------------------------------------------------------------ ③ 否决
-- TERMINATED 是 TaskflowStatus.Instance 的合法值（不是 CANCELED）。
INSERT INTO wf_instance (id, tenant_id, definition_id, definition_code, started_form_code,
                         business_type, business_id, status, initiator_id, initiator_name,
                         current_node_code, form_data, progress, extra_context,
                         post_process_status, completed_at, created_at, updated_at)
SELECT 960103, 1, 950001, 'PURCHASE_APPROVAL_DEMO', 'PUR_FORM',
       'PURCHASE_ORDER', 'PO-DEMO-2601-0003', 'TERMINATED', 1, 'admin',
       'approve',
       jsonb_build_object(
         'orderNo',    'PO-2601-0003',
         'supplier',   '宏远办公设备有限公司',
         'amount',     8900,
         'applyDate',  '2026-01-10',
         'priority',   'LOW',
         'categories', jsonb_build_array('LOGISTICS', 'HARDWARE'),
         'urgent',     false,
         'reason',     '行政工位显示器与搬运服务，金额超出部门季度预算'),
       '1/2', jsonb_build_object('demoSeed', 'V129', 'scenario', 'REJECTED'),
       'WAITING', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_instance WHERE id = 960103)
  AND NOT EXISTS (SELECT 1 FROM wf_instance WHERE tenant_id = 1 AND business_id = 'PO-DEMO-2601-0003')
  AND EXISTS (SELECT 1 FROM wf_definition WHERE id = 950001);

-- ⚠️ 否决场景：wf_task 仍是 COMPLETED（任务本身办结了），
--    终止语义由 wf_instance.status=TERMINATED + wf_history.operation=REJECT 表达。
INSERT INTO wf_task (id, tenant_id, instance_id, node_code, node_name, task_type,
                     sys_task_id, assignee_id, assignee_name, status, action_result, completed_at, created_at)
SELECT 960114, 1, 960103, 'approve', '主管审批', 'APPROVE',
       NULL, 1, 'admin', 'COMPLETED',
       jsonb_build_object('approved', false, 'comment', '超出部门季度预算，请下季度重新申报'),
       NOW() - INTERVAL '2 days', NOW() - INTERVAL '3 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_task WHERE id = 960114)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960103);

INSERT INTO sys_task (id, tenant_id, task_type, biz_type, biz_ref_id, biz_title,
                      target_entity, assignee_id, assignee_name, status, priority,
                      metadata, read_flag, completed_at, deleted, created_by, created_at, updated_at)
SELECT 960123, 1, 'PURCHASE_APPROVAL_DEMO', 'PURCHASE_ORDER', 'PO-DEMO-2601-0003',
       '主管审批 · 采购申请 PO-2601-0003', 'wf_task', 1, 'admin', 'REJECTED', 2,
       jsonb_build_object('demoSeed', 'V129', 'scenario', 'REJECTED'),
       TRUE, NOW() - INTERVAL '2 days', 0, 1, NOW() - INTERVAL '3 days', NOW() - INTERVAL '2 days'
WHERE NOT EXISTS (SELECT 1 FROM sys_task WHERE id = 960123)
  AND NOT EXISTS (SELECT 1 FROM sys_task WHERE biz_ref_id = 'PO-DEMO-2601-0003')
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960103);

INSERT INTO wf_history (id, instance_id, node_code, operator_id, operator_name,
                        operation, from_node, to_node, comment, duration_seconds, created_at)
SELECT 960133, 960103, 'start', 1, 'admin', 'SUBMIT', NULL, 'approve',
       '提交采购申请', NULL, NOW() - INTERVAL '3 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_history WHERE id = 960133)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960103);

INSERT INTO wf_history (id, instance_id, node_code, operator_id, operator_name,
                        operation, from_node, to_node, comment, duration_seconds, created_at)
SELECT 960134, 960103, 'approve', 1, 'admin', 'REJECT', 'approve', NULL,
       '超出部门季度预算，请下季度重新申报', 86400.0, NOW() - INTERVAL '2 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_history WHERE id = 960134)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960103);

-- ---------------------------------------------------------------- ④ 已通过
-- 全链路走完：实例 COMPLETED、全部任务 COMPLETED、后处理 SUCCESS。
INSERT INTO wf_instance (id, tenant_id, definition_id, definition_code, started_form_code,
                         business_type, business_id, status, initiator_id, initiator_name,
                         current_node_code, form_data, progress, extra_context,
                         post_process_status, post_process_time, post_process_msg,
                         completed_at, created_at, updated_at)
SELECT 960104, 1, 950001, 'PURCHASE_APPROVAL_DEMO', 'PUR_FORM',
       'PURCHASE_ORDER', 'PO-DEMO-2601-0004', 'COMPLETED', 1, 'admin',
       'end',
       jsonb_build_object(
         'orderNo',    'PO-2601-0004',
         'supplier',   '北方智算数据服务有限公司',
         'amount',     268000,
         'applyDate',  '2026-01-06',
         'priority',   'HIGH',
         'categories', jsonb_build_array('HARDWARE', 'SERVICE', 'LOGISTICS'),
         'urgent',     true,
         'reason',     '年度数据中心扩容：GPU 服务器 12 台+ 三年原厂维保 + 到场部署'),
       '2/2', jsonb_build_object('demoSeed', 'V129', 'scenario', 'APPROVED'),
       'SUCCESS', NOW() - INTERVAL '4 days', '采购单已推送 ERP 并生成入库计划',
       NOW() - INTERVAL '4 days', NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_instance WHERE id = 960104)
  AND NOT EXISTS (SELECT 1 FROM wf_instance WHERE tenant_id = 1 AND business_id = 'PO-DEMO-2601-0004')
  AND EXISTS (SELECT 1 FROM wf_definition WHERE id = 950001);

INSERT INTO wf_task (id, tenant_id, instance_id, node_code, node_name, task_type,
                     sys_task_id, assignee_id, assignee_name, status, action_result, completed_at, created_at)
SELECT 960115, 1, 960104, 'approve', '主管审批', 'APPROVE',
       NULL, 1, 'admin', 'COMPLETED',
       jsonb_build_object('approved', true, 'comment', '同意，已与预算确认'), NOW() - INTERVAL '4 days',
       NOW() - INTERVAL '5 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_task WHERE id = 960115)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960104);

INSERT INTO sys_task (id, tenant_id, task_type, biz_type, biz_ref_id, biz_title,
                      target_entity, assignee_id, assignee_name, status, priority,
                      metadata, read_flag, completed_at, deleted, created_by, created_at, updated_at)
SELECT 960124, 1, 'PURCHASE_APPROVAL_DEMO', 'PURCHASE_ORDER', 'PO-DEMO-2601-0004',
       '主管审批 · 采购申请 PO-2601-0004', 'wf_task', 1, 'admin', 'APPROVED', 4,
       jsonb_build_object('demoSeed', 'V129', 'scenario', 'APPROVED'),
       TRUE, NOW() - INTERVAL '4 days', 0, 1, NOW() - INTERVAL '5 days', NOW() - INTERVAL '4 days'
WHERE NOT EXISTS (SELECT 1 FROM sys_task WHERE id = 960124)
  AND NOT EXISTS (SELECT 1 FROM sys_task WHERE biz_ref_id = 'PO-DEMO-2601-0004')
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960104);

INSERT INTO wf_history (id, instance_id, node_code, operator_id, operator_name,
                        operation, from_node, to_node, comment, duration_seconds, created_at)
SELECT 960135, 960104, 'start', 1, 'admin', 'SUBMIT', NULL, 'approve',
       '提交采购申请', NULL, NOW() - INTERVAL '5 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_history WHERE id = 960135)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960104);

INSERT INTO wf_history (id, instance_id, node_code, operator_id, operator_name,
                        operation, from_node, to_node, comment, duration_seconds, created_at)
SELECT 960136, 960104, 'approve', 1, 'admin', 'APPROVE', 'approve', 'end',
       '同意，已与预算确认', 93600.0, NOW() - INTERVAL '4 days'
WHERE NOT EXISTS (SELECT 1 FROM wf_history WHERE id = 960136)
  AND EXISTS (SELECT 1 FROM wf_instance WHERE id = 960104);

-- ===========================================================================
-- 5) 回填 wf_task.sys_task_id
--
--    刻意**放在最后**并单独 UPDATE：wf_task 的插入不能依赖 sys_task 已存在，
--    否则 V129 的执行顺序就变成强耦合。UPDATE ... WHERE sys_task_id IS NULL
--    保证重复执行不会覆盖已绑定的关系。
--
-- ⚠️ 必须**经 wf_instance 关联**sys_task，不能只靠 `s.biz_ref_id IN (...)`：
--    那样写出来的是笛卡尔积（4 个实例 × 4 个 sys_task），
--    一个 UPDATE 会把**所有** wf_task 都绑到同一个 sys_task（实测bind 成960121）。
--    正确写法是 JOIN 上 instance，让 biz_ref_id 与具体实例的 business_id 一一对应。
-- ===========================================================================
UPDATE wf_task t
SET sys_task_id = s.id
FROM wf_instance i, sys_task s
WHERE t.sys_task_id IS NULL
  AND i.id = t.instance_id
  AND s.tenant_id = t.tenant_id
  AND s.biz_ref_id = i.business_id
  AND i.id IN (960101, 960102, 960103, 960104);

-- ---------------------------------------------------------------------------
-- 自检（供手工执行核对，迁移本身不依赖）
-- SELECT code, supported_form_codes FROM wf_definition WHERE id = 950001;
-- SELECT source_node, target_node, edge_type FROM wf_edge WHERE definition_id = 950001 ORDER BY sort_order;
-- SELECT code, status, tenant_id FROM form_definition WHERE code = 'PUR_FORM';
-- SELECT i.id, i.business_id, i.status AS inst_status, i.current_node_code, i.progress,
--        count(t.id) FILTER (WHERE t.status = 'PENDING')   AS pending_tasks,
--        count(t.id) FILTER (WHERE t.status = 'COMPLETED') AS completed_tasks,
--        i.form_data
--   FROM wf_instance i LEFT JOIN wf_task t ON t.instance_id = i.id
--  WHERE i.id IN (960101, 960102, 960103, 960104)
--  GROUP BY i.id ORDER BY i.id;
-- ---------------------------------------------------------------------------