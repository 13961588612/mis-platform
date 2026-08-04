-- ===========================================================================
-- V15__kb_incremental.sql —— 知识库 P1/P2 增量迁移
--
-- 设计依据：docs/backend/mis-kb-incremental-design-2026-08-03.md §2.1 / T01
--
-- 【版本号说明】设计文档写的是 V14__kb_incremental.sql，但仓库中 V14 已被
-- V14__kb_menu_buttons_and_grants.sql 占用（P0 交付时新增）。Flyway 版本号必须唯一，
-- 故本脚本顺延为 V15。设计文档中 T01 的文件名需同步修订为 V15__kb_incremental.sql。
--
-- 覆盖范围：
--   1. kb_qa_ticket  —— 自建轻量工单（A-02c）：补 note / time_line / rel_action
--                        / processor_id / updated_at，并补齐 status·type CHECK 与索引
--   2. kb_qa_citation —— 引用溯源增强（F-04）：补 chunk_offset / page_no / source
--   3. kb_acl        —— I-03 主体扩展：subject_type CHECK 增加 'dept'
--   4. rag_settings  —— 见文末说明：为 kb_library.rag_settings_json 的 JSON 内嵌结构，
--                        本次扩展仅是 JSON schema 变更，无需 DDL（保持向后兼容）
--
-- 幂等性：全部使用 IF NOT EXISTS / DROP CONSTRAINT IF EXISTS，可重复执行。
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. kb_qa_ticket：P0 占位表 → P1 可用工单（A-02c 自建轻量工单）
-- ---------------------------------------------------------------------------
-- 既有列：id / session_id / type / status / content / handler_id / created_at
ALTER TABLE kb_qa_ticket ADD COLUMN IF NOT EXISTS note         TEXT NULL;
ALTER TABLE kb_qa_ticket ADD COLUMN IF NOT EXISTS time_line    TEXT NULL;
ALTER TABLE kb_qa_ticket ADD COLUMN IF NOT EXISTS rel_action   VARCHAR(32) NULL;
ALTER TABLE kb_qa_ticket ADD COLUMN IF NOT EXISTS processor_id BIGINT NULL;
ALTER TABLE kb_qa_ticket ADD COLUMN IF NOT EXISTS message_id   BIGINT NULL;
ALTER TABLE kb_qa_ticket ADD COLUMN IF NOT EXISTS creator_id   BIGINT NULL;
ALTER TABLE kb_qa_ticket ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW();

COMMENT ON COLUMN kb_qa_ticket.note         IS '处理备注（运营侧填写）';
COMMENT ON COLUMN kb_qa_ticket.time_line    IS '状态流转时间线（JSON 数组文本，见 KbTicketTimelineEntry）';
COMMENT ON COLUMN kb_qa_ticket.rel_action   IS '关联动作：none/add_doc/fix_doc/adjust_acl/adjust_rag';
COMMENT ON COLUMN kb_qa_ticket.processor_id IS '当前处理人 userId（与 handler_id 语义区分：handler=受理人，processor=当前处理人）';
COMMENT ON COLUMN kb_qa_ticket.message_id   IS '触发工单的问答消息 id（F-10 一键报错时回填）';
COMMENT ON COLUMN kb_qa_ticket.creator_id   IS '提单人 userId';

-- 状态/类型码值约束（P0 未加，P1 补齐）
ALTER TABLE kb_qa_ticket DROP CONSTRAINT IF EXISTS chk_kb_ticket_status;
ALTER TABLE kb_qa_ticket ADD  CONSTRAINT chk_kb_ticket_status
    CHECK (status IS NULL OR status IN ('open', 'processing', 'resolved', 'closed'));

ALTER TABLE kb_qa_ticket DROP CONSTRAINT IF EXISTS chk_kb_ticket_type;
ALTER TABLE kb_qa_ticket ADD  CONSTRAINT chk_kb_ticket_type
    CHECK (type IS NULL OR type IN ('answer_error', 'cite_error', 'missing_doc', 'permission', 'other'));

ALTER TABLE kb_qa_ticket DROP CONSTRAINT IF EXISTS chk_kb_ticket_rel_action;
ALTER TABLE kb_qa_ticket ADD  CONSTRAINT chk_kb_ticket_rel_action
    CHECK (rel_action IS NULL OR rel_action IN ('none', 'add_doc', 'fix_doc', 'adjust_acl', 'adjust_rag'));

CREATE INDEX IF NOT EXISTS idx_kb_qa_ticket_status    ON kb_qa_ticket(status);
CREATE INDEX IF NOT EXISTS idx_kb_qa_ticket_processor ON kb_qa_ticket(processor_id);
CREATE INDEX IF NOT EXISTS idx_kb_qa_ticket_creator   ON kb_qa_ticket(creator_id);
CREATE INDEX IF NOT EXISTS idx_kb_qa_ticket_created   ON kb_qa_ticket(created_at DESC);

-- ---------------------------------------------------------------------------
-- 2. kb_qa_citation：引用溯源增强（F-04 定位到页/偏移）
-- ---------------------------------------------------------------------------
-- 注意：offset / page 在 PostgreSQL 中为保留字（offset 尤甚），故落库列名加前缀，
--       对外 VO/JSON 字段仍为 offset / page / source（见 QaCitationVO）。
ALTER TABLE kb_qa_citation ADD COLUMN IF NOT EXISTS chunk_offset INT NULL;
ALTER TABLE kb_qa_citation ADD COLUMN IF NOT EXISTS page_no      INT NULL;
ALTER TABLE kb_qa_citation ADD COLUMN IF NOT EXISTS source       VARCHAR(256) NULL;

COMMENT ON COLUMN kb_qa_citation.chunk_offset IS '片段在原文中的字符偏移（对外 JSON 字段名 offset）';
COMMENT ON COLUMN kb_qa_citation.page_no      IS '片段所在页码，从 1 开始（对外 JSON 字段名 page）';
COMMENT ON COLUMN kb_qa_citation.source       IS '来源标识（文档标题/文件名/外部 URL），便于前端直接展示';

CREATE INDEX IF NOT EXISTS idx_kb_qa_citation_doc ON kb_qa_citation(document_id);

-- ---------------------------------------------------------------------------
-- 3. kb_acl：I-03 授权主体扩展 —— 增加部门（dept）
-- ---------------------------------------------------------------------------
-- P0 约束：subject_type IN ('user','role')；P1 与 PRD「用户/角色/部门」对齐。
-- subject_type 列宽 VARCHAR(8)，'dept'(4) 未超限，无需改列宽。
ALTER TABLE kb_acl DROP CONSTRAINT IF EXISTS chk_kb_acl_subject;
ALTER TABLE kb_acl ADD  CONSTRAINT chk_kb_acl_subject
    CHECK (subject_type IN ('user', 'role', 'dept'));

-- action 保持 read/manage/acl 三值不变（X-02 是前端向后端对齐，后端无需改）。
-- 此处显式重建一次，确保历史环境约束存在且一致。
ALTER TABLE kb_acl DROP CONSTRAINT IF EXISTS chk_kb_acl_action;
ALTER TABLE kb_acl ADD  CONSTRAINT chk_kb_acl_action
    CHECK (action IN ('read', 'manage', 'acl'));

COMMENT ON COLUMN kb_acl.subject_type IS '授权主体类型：user 用户 / role 角色 / dept 部门（dept 于 V15 增加）';

CREATE INDEX IF NOT EXISTS idx_kb_acl_lib_action ON kb_acl(library_id, action);

-- ---------------------------------------------------------------------------
-- 4. rag_settings 扩展说明（无 DDL）
-- ---------------------------------------------------------------------------
-- RAG 设置并非独立物理表，而是序列化存放于 kb_library.rag_settings_json（TEXT）。
-- 本次扩展新增 4 个 JSON 字段（均可空，向后兼容旧数据）：
--   chunkMethod          分块方法（naive/qa/paper/book/laws/presentation/table/picture/one）
--   chunkTokenNum        分块 token 数（默认 128）
--   separator            分块分隔符
--   emptyResultStrategy  空结果策略（SUGGEST 推荐相关问题 / EMPTY 直接空 / TRANSFER 转人工）
-- 旧记录反序列化时上述字段为 null，由 RagSettings.withDefaults() 兜底默认值，
-- 因此不需要数据回填脚本。此注释保留作为 schema 变更的可追溯记录。
COMMENT ON COLUMN kb_library.rag_settings_json IS
    'MIS 规范 RAG 设置(JSON)：topK/scoreThreshold/rerank/embeddingModel/retrievalMethod'
    ' + V15 新增 chunkMethod/chunkTokenNum/separator/emptyResultStrategy';
