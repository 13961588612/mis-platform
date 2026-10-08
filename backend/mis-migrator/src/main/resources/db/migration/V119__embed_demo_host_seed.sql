-- MIS Platform — 本地/联调嵌入宿主种子（embed-demo）
-- PostgreSQL 16 | 库名: mis_platform
-- 依据：docs/integration/embed-copilot.md / docs/ai-fusion/a2ui/01-architecture.md D12
--
-- 内容：
--   1. agent_external_host：host_id = embed-demo（本地联调默认宿主）
--   2. 不写生产密钥；client_secret_hash 对应开发明文：
--      embed-demo-local-secret-do-not-use-in-prod
--      sha256 = 03b41217a5fd9210de55bd8cdb959d34b6875036da2820dfdc58fb6912e7d1b3
--   3. shadow_mis_user_id = '1'（约定本地平台管理员；生产须改为真实映射用户）
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
    'embed-demo',
    'Embed Demo Host（本地联调）',
    'embed-demo-client',
    '03b41217a5fd9210de55bd8cdb959d34b6875036da2820dfdc58fb6912e7d1b3',
    '["http://localhost:5173","http://127.0.0.1:5173","https://mis.local"]'::json,
    '1',
    'active',
    1,
    NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM agent_external_host WHERE host_id = 'embed-demo'
);
