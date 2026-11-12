-- V165__ai_workflow_platform_aliyun_bailian.sql
-- 模板报告：外部 AI 工作流平台增加「阿里百炼」主数据（仅配置项；对接调用后续实现）
-- PostgreSQL 16 | 幂等

INSERT INTO ai_workflow_platform (id, platform_code, name, config_json, enabled, created_at, updated_at)
SELECT 10011,
       'aliyun-bailian',
       '阿里百炼',
       '{"provider":"aliyun-bailian"}'::jsonb,
       1,
       NOW(),
       NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM ai_workflow_platform
     WHERE id = 10011 OR platform_code = 'aliyun-bailian'
);
