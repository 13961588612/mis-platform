-- ===========================================================================
-- V62__kb_document_chunk_parser_settings.sql —— 文档级解析器设置扩展（T4）
--
-- 设计依据：docs/backend/ragflow-chunk-settings-design-2026-08-19.md（T4 任务）
--          PRD R-P1-01（文件级模型）
--
-- 方案 B 续（V23 的 3 列之后新增 4 列）：kb_document 新增四列，均可空：
--   page_index               文件级页码索引/TOC 提取开关（null = 继承库级）
--   image_table_context_window 文件级图像/表格上下文窗口 token 数（null = 继承库级）
--   auto_keywords            文件级自动关键字数量（0=关闭，0~32；null = 继承库级）
--   auto_questions           文件级自动问题数量（0=关闭，0~10；null = 继承库级）
--
-- 语义（快照继承，T5）：任一文件级字段非空 = 「文件指定」；生效值 =
-- 文件级 ?? 库级 ?? 全局默认，合并逻辑统一收口在 DocumentChunkConfigResolver
-- （服务层不得内联判断，设计 §7.2 铁律）。MIS 新列保持 NULL = 继承库级
-- （不做列复制；引擎上传时已把 dataset parser_config 快照进 document）。
-- 存量文档四列保持 NULL，读取行为与现状一致（继承库级），无需数据回填。
--
-- 幂等性：全部 ADD COLUMN IF NOT EXISTS + COMMENT，可重复执行（Flyway 集中在
-- mis-migrator，设计 §8-12 铁律）。最新版本号 V62。
-- ===========================================================================

ALTER TABLE kb_document ADD COLUMN IF NOT EXISTS page_index                 BOOLEAN NULL;
ALTER TABLE kb_document ADD COLUMN IF NOT EXISTS image_table_context_window INT     NULL;
ALTER TABLE kb_document ADD COLUMN IF NOT EXISTS auto_keywords              INT     NULL;
ALTER TABLE kb_document ADD COLUMN IF NOT EXISTS auto_questions             INT     NULL;

COMMENT ON COLUMN kb_document.page_index                 IS '文件级页码索引/TOC 提取开关（true/false）；null=继承库级';
COMMENT ON COLUMN kb_document.image_table_context_window IS '文件级图像/表格上下文窗口 token 数（[1,4096]）；null=继承库级';
COMMENT ON COLUMN kb_document.auto_keywords              IS '文件级自动关键字数量（0=关闭，0~32）；null=继承库级';
COMMENT ON COLUMN kb_document.auto_questions             IS '文件级自动问题数量（0=关闭，0~10）；null=继承库级';
