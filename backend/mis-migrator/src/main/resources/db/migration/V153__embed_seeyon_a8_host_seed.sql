-- MIS Platform — 致远 OA A8 ticket-pull 宿主种子
-- PostgreSQL 16 | 库名: mis_platform
-- 依据：docs/integration/seeyon-a8-ticket-sso.md
--
-- 内容：
--   1. agent_external_host：host_id = seeyon-a8
--   2. client_secret_hash 为占位（纯 ticket 模式不验 HS256；与配置交叉校验时 ticket 路径不读 secret）
--   3. shadow 默认空：一期靠手机号映射；生产补 allowed_origins 为真实致远域
--
-- 幂等：WHERE NOT EXISTS；Flyway 只追加。

INSERT INTO agent_external_host (
    host_id,
    host_name,
    client_id,
    client_secret_hash,
    allowed_origins,
    shadow_mis_user_id,
    status,
    tenant_id,
    created_at
)
SELECT
    'seeyon-a8',
    '致远 OA A8（ticket SSO）',
    'seeyon-a8-client',
    -- 占位 hash（sha256 of "seeyon-a8-ticket-placeholder-not-for-push-mode"）
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    '["http://localhost:5173","http://127.0.0.1:5173"]'::json,
    NULL,
    'active',
    1,
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM agent_external_host WHERE host_id = 'seeyon-a8'
);
