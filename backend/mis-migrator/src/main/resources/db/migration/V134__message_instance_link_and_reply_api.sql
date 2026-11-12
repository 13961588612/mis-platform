-- V134__message_instance_link_and_reply_api.sql
-- 门户重构后端补强（PR-08 消息↔流程实例关联 + PR-18 回复回写审批意见）
-- PostgreSQL 16
--
-- ## 为什么需要它
--
-- 1) 消息与流程实例之间没有任何直接线索：{@code sys_message} 只有 reference_task_id
--    （语义 = 关联代办 sys_task），而 ProcessService.notify(...) 发出的结果通知
--    reference_task_id=NULL，导致「流程通知看表单」(PR-07) 与「回复回写审批意见」(PR-18)
--    都无法单跳定位实例。故新增专用列 sys_message.instance_id（软引用 wf_instance.id，
--    无外键，与 started_form_code / category_id 一脉）。
-- 2) 新增「回复消息」端点 POST /api/v1/messages/{id}/reply 属于新路径，必须登记 sys_api
--    并绑定到授权菜单——BFF 的 mis.security.api-permission.deny-unmapped:true 只放行
--    已映射端点，否则一律 403（这是「漏登记/错绑 sys_api」坑的第 N 次变体）。
--
-- ## 幂等策略（对齐既有迁移风格）
--
--   * ALTER TABLE ... ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS —— 天然幂等
--   * sys_api / sys_menu_api —— 先按固定 ID DELETE 再 INSERT（重跑时先删旧行再插，
--     不会触发主键/唯一约束；DBA 手工重跑亦安全）
--   * 全程 NOW()，不用非确定函数
--
-- ## ID 段位（已连库实测核实）
--
--   sys_api      95020-95048 / 95050-95056 / 95060-95065 / 95066-95071 已占；95072 空闲 ✅
--   sys_menu_api 95020-95048 / 95050-95059 / 95076 / 95080-95091 已占；95092 空闲 ✅
--   sys_menu     95003「消息与待办」(taskflow-inbox, /task/inbox, 个人事务可见) 存在 ✅
--                （V127 已将其 permission 置 NULL = 登录即可，故无需额外授权）
--
-- ⚠️ 只追加；绝不修改 V120~V133（checksum 变更会阻塞整条迁移链）。

-- ===========================================================================
-- 1) 消息表：新增流程实例软引用列 + 索引
-- ===========================================================================
ALTER TABLE sys_message ADD COLUMN IF NOT EXISTS instance_id BIGINT NULL;

CREATE INDEX IF NOT EXISTS idx_msg_instance ON sys_message (instance_id);

-- ===========================================================================
-- 2) 登记「回复消息」端点 sys_api 95072
--    POST /api/v1/messages/{id:[0-9]+}/reply
-- ===========================================================================
DELETE FROM sys_menu_api WHERE id = 95092;

DELETE FROM sys_api WHERE id = 95072;

INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
VALUES (95072, 95010, 95010, '00950072', 'api'::sys_api_node_type, '回复消息', 'POST',
        '/api/v1/messages/{id:[0-9]+}/reply', 72, 1, NOW(), NOW());

-- ===========================================================================
-- 3) 绑定端点 → 菜单 95003「消息与待办」（消息中心抽屉的回复入口）
-- ===========================================================================
INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
VALUES (95092, 95003, 95072, 6, NOW());

-- 自检（取消注释手动执行）：
-- SELECT id, code, name, http_method, path_pattern FROM sys_api WHERE id = 95072;
-- SELECT id, menu_id, api_id FROM sys_menu_api WHERE id = 95092;
-- SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name='sys_message' AND column_name='instance_id';
