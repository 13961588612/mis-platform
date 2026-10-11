-- V137__app_biz_binding.sql
-- 平台级 vs 应用级：业务类型 → APP 归属推导表（P0） | PostgreSQL 16 | 幂等：可重复执行
--
-- ## 为什么需要它
-- 消息 / 待办在**创建**时若能显式带上 app_code 则最准（M1/T1 外部写入口）。
-- 但内部流程路径（M4 notify / T2 assignNode）拿不到显式 code，只能凭
-- wf_instance.business_type（或 sys_task.biz_type）反查「这条业务属于哪个 APP」。
-- 这张小表即该反查的单一事实源（设计 §1.3 方案 D）。
--
-- ## 结构约定
--   * 复合主键 (tenant_id, biz_type)：一个租户内一种业务类型只归属一个 APP。
--   * app_code 存 sys_app.code（字符串），**不建外键**——sys_app 的唯一键是
--     (tenant_id, code)，且 APP 可被删除/停用；参照 sys_message.instance_id 的既有做法
--     （V134 软引用、无外键），保持一致。
--   * biz_type 对应 sys_task.biz_type / wf_instance.business_type。
--
-- ## 幂等
--   * CREATE TABLE IF NOT EXISTS                 —— 天然幂等
--   * INSERT ... WHERE NOT EXISTS                —— 幂等种子（重跑不重复、不报错）
--
-- ⚠️ 只追加；绝不修改 V1~V136（checksum 变更会阻塞整条迁移链）。

-- 1) 绑定表
CREATE TABLE IF NOT EXISTS sys_app_biz_binding (
    tenant_id  BIGINT      NOT NULL,
    biz_type   VARCHAR(64) NOT NULL,
    app_code   VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pk_app_biz_binding PRIMARY KEY (tenant_id, biz_type)
);

-- 2) 幂等种子（唯一一条：PURCHASE_ORDER → system；其余业务类型待业务登记）
--    tenant_id = 1（单租户阶段，与 V2 系统种子同口径）。
INSERT INTO sys_app_biz_binding (tenant_id, biz_type, app_code, created_at, updated_at)
SELECT 1, 'PURCHASE_ORDER', 'system', NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM sys_app_biz_binding WHERE tenant_id = 1 AND biz_type = 'PURCHASE_ORDER'
);

-- 自检（取消注释手动执行）：
-- SELECT tenant_id, biz_type, app_code FROM sys_app_biz_binding ORDER BY tenant_id, biz_type;
