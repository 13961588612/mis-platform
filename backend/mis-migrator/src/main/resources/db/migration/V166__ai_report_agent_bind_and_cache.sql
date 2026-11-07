-- V166：模板报告绑定目标 Agent/Skill + 成文缓存 | PostgreSQL 16 | 幂等

ALTER TABLE ai_report_def
    ADD COLUMN IF NOT EXISTS target_agent_id VARCHAR(128) NULL;

ALTER TABLE ai_report_def
    ADD COLUMN IF NOT EXISTS target_skill_id VARCHAR(128) NULL;

ALTER TABLE ai_report_def
    ADD COLUMN IF NOT EXISTS prompt_template TEXT NULL;

ALTER TABLE ai_report_def
    ADD COLUMN IF NOT EXISTS cache_ttl_hours INT NOT NULL DEFAULT 24;

COMMENT ON COLUMN ai_report_def.target_agent_id IS '成文硬派发 Worker agent_id；use_ai_workflow=1 时必填';
COMMENT ON COLUMN ai_report_def.target_skill_id IS '可选：强制先 skill() 加载的 skill_id';
COMMENT ON COLUMN ai_report_def.prompt_template IS '用户任务提示词模板，占位符为槽位 wire_key';
COMMENT ON COLUMN ai_report_def.cache_ttl_hours IS '成文缓存 TTL（小时），默认 24';

CREATE TABLE IF NOT EXISTS ai_report_result_cache (
    id              BIGINT       PRIMARY KEY,
    report_code     VARCHAR(64)  NOT NULL,
    params_hash     VARCHAR(64)  NOT NULL,
    params_json     JSONB        NOT NULL DEFAULT '{}'::jsonb,
    content_md      TEXT         NOT NULL,
    agent_id        VARCHAR(128) NULL,
    skill_id        VARCHAR(128) NULL,
    created_by      BIGINT       NULL,
    cached_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_ai_report_result_cache UNIQUE (report_code, params_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_report_result_cache_expires
    ON ai_report_result_cache (expires_at);

COMMENT ON TABLE ai_report_result_cache IS '模板报告成文缓存：同 report_code+规范化参数哈希可跨用户复用；读前仍过 ACL';

-- results 回写 API
INSERT INTO sys_api (id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
SELECT v.id, v.module_id, v.parent_id, v.code, v.type, v.name, v.http_method, v.path_pattern, v.sort, v.status, v.created_at, v.updated_at
FROM (VALUES
    (93232, 92020, 93210, '00980121', 'api'::sys_api_node_type, '报告成文回写缓存', 'POST', '/api/v1/ai-reports/results', 21, 1, NOW(), NOW())
) AS v(id, module_id, parent_id, code, type, name, http_method, path_pattern, sort, status, created_at, updated_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_api a WHERE a.id = v.id)
  AND NOT EXISTS (
    SELECT 1 FROM sys_api a
    WHERE a.type = 'api' AND a.status = 1
      AND a.http_method = v.http_method
      AND a.path_pattern = v.path_pattern
  )
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = 93210);

INSERT INTO sys_menu_api (id, menu_id, api_id, sort, created_at)
SELECT v.* FROM (VALUES
    (93268, 93201, 93232, 11, NOW()),
    (93269, 93040, 93232, 94, NOW())
) AS v(id, menu_id, api_id, sort, created_at)
WHERE NOT EXISTS (SELECT 1 FROM sys_menu_api WHERE id = v.id)
  AND EXISTS (SELECT 1 FROM sys_menu WHERE id = v.menu_id)
  AND EXISTS (SELECT 1 FROM sys_api WHERE id = v.api_id);
