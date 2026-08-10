-- ===========================================================================
-- V23__kb_document_chunk_config.sql —— 文档级切片覆盖字段（kb_settings_model_chunk）
--
-- 设计依据：docs/backend/mis-kb-settings-model-chunk-design-2026-08-10.md
--          PRD R-P0-06（切片文件级方案 B 数据模型）
--
-- 方案 B：库级默认 + 文件级覆盖。kb_document 新增三列，均可空：
--   chunk_method    文件级切片方法（null = 继承库级）
--   chunk_token_num 文件级切片 token 数（null = 继承库级）
--   separator       文件级切片分隔符（null = 继承库级）
--
-- 语义：任一文件级字段非空 = 「文件指定」；生效值 = 文件级 ?? 库级 ?? 全局默认，
-- 合并逻辑统一收口在 DocumentChunkConfigResolver（服务层不得内联判断，设计 §7.2 铁律）。
-- 存量文档三列保持 NULL，读取行为与现状一致（继承库级），无需数据回填。
--
-- 幂等性：全部 ADD COLUMN IF NOT EXISTS + COMMENT，可重复执行（Flyway 集中在 mis-migrator，
-- 设计 §8-12 铁律）。最新版本号 V23。
-- ===========================================================================

ALTER TABLE kb_document ADD COLUMN IF NOT EXISTS chunk_method    VARCHAR(32) NULL;
ALTER TABLE kb_document ADD COLUMN IF NOT EXISTS chunk_token_num INT         NULL;
ALTER TABLE kb_document ADD COLUMN IF NOT EXISTS separator       TEXT        NULL;

COMMENT ON COLUMN kb_document.chunk_method    IS '文件级切片方法（naive/qa/paper/book/laws/presentation/table/picture/one）；null=继承库级';
COMMENT ON COLUMN kb_document.chunk_token_num IS '文件级切片 token 数（正整数，建议 16~4096）；null=继承库级';
COMMENT ON COLUMN kb_document.separator       IS '文件级切片分隔符（允许纯空白）；null=继承库级';
