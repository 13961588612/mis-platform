-- ===========================================================================
-- V66__agent_ops_config_files_path_wildcard.sql
--   T04 收口后配置文件读/写 wire 从 query 形态
--     GET|PUT /api/v1/agent-ops/agents/{id}/config-files/content(?path=)
--   改为多段路径捕获
--     GET|PUT /api/v1/agent-ops/agents/{id}/config-files/{*file}
--   （例：.../config-files/runtime/prompts/system.md）
--
--   V20 仍登记字面量尾段 `/content`；ApiPermissionRegistry 用 AntPathMatcher，
--   `{var}` 只匹配**单段**，多段相对路径命中不到 → deny-unmapped → 40300「接口未授权映射」。
--
--   修正：把 00920023 / 00920024 的 path_pattern 改为 `.../config-files/**`
--   （Ant 通配，匹配零或多段；权限码与 menu_api 绑定不变）。
--
--   前置：V20；Flyway 只追加，不改已发布脚本。
-- ===========================================================================

UPDATE sys_api
SET path_pattern = '/api/v1/agent-ops/agents/{id}/config-files/**',
    updated_at   = NOW()
WHERE id = 92122
  AND code = '00920023'
  AND path_pattern = '/api/v1/agent-ops/agents/{id}/config-files/content';

UPDATE sys_api
SET path_pattern = '/api/v1/agent-ops/agents/{id}/config-files/**',
    updated_at   = NOW()
WHERE id = 92123
  AND code = '00920024'
  AND path_pattern = '/api/v1/agent-ops/agents/{id}/config-files/content';

-- ---------------------------------------------------------------------------
-- 迁移后自检
--
--   SELECT id, code, http_method, path_pattern
--   FROM sys_api
--   WHERE id IN (92122, 92123);
--   -- 期望 path_pattern 均为 .../config-files/**
--
--   然后重启 mis-admin-bff（或等 refresh-interval-seconds，默认 300s）。
-- ---------------------------------------------------------------------------
