-- V169：日报 Skill 已更名为 sm-shop-ops-diary-report，纠正报告绑定
-- PostgreSQL 16 | 幂等

UPDATE ai_report_def
SET target_skill_id = 'sm-shop-ops-diary-report',
    updated_at = NOW()
WHERE target_skill_id = 'sm-shop-ops-daily-report';
