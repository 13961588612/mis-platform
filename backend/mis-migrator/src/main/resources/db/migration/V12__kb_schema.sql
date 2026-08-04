-- MIS Platform — 知识库（mis-kb）核心表结构
-- PostgreSQL 16 | 库名: mis_platform
-- 设计：docs/backend/mis-kb-system-design.md §3
-- 复用约定：
--   * 密级 kb_library.secrecy 存 sys_dict(kb_secrecy) 的 value（码值），加 CHECK 约束；应用层校验字典存在
--   * ACL(kb_acl) 的 subject_id 复用 mis-iam/mis-org 主体 id，不建本地用户/角色表
--   * P0 单租户，kb_* 表不加 tenant_id（预留注释，多租户隔离待 §13 裁定）

-- ---------------------------------------------------------------------------
-- 1. 分类（kb_category）
-- ---------------------------------------------------------------------------
CREATE TABLE kb_category (
    id          BIGINT PRIMARY KEY,
    parent_id   BIGINT NULL,
    name        VARCHAR(128) NOT NULL,
    enabled     SMALLINT NOT NULL DEFAULT 1,
    sort        INT NOT NULL DEFAULT 0,
    remark      VARCHAR(512) NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kb_category_parent ON kb_category(parent_id);

-- ---------------------------------------------------------------------------
-- 2. 知识库（kb_library）
-- ---------------------------------------------------------------------------
CREATE TABLE kb_library (
    id                 BIGINT PRIMARY KEY,
    category_id        BIGINT NOT NULL,
    name               VARCHAR(128) NOT NULL,
    secrecy            VARCHAR(32) NOT NULL,          -- 复用 sys_dict(kb_secrecy) 的 value
    status             SMALLINT NOT NULL DEFAULT 1,   -- 1=enabled 0=disabled
    owner              BIGINT NULL,
    engine_type        VARCHAR(32) NOT NULL DEFAULT 'ragflow',
    engine_library_ref VARCHAR(128) NULL,             -- RAGFlow dataset id（对外只认 MIS libraryId）
    rag_settings_json  TEXT NULL,                     -- MIS 规范 RAG 设置(JSON)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_kb_lib_cat_name UNIQUE (category_id, name),
    CONSTRAINT chk_kb_lib_secrecy CHECK (secrecy IN ('public','internal','secret','confidential'))
);
CREATE INDEX idx_kb_lib_cat ON kb_library(category_id);
CREATE INDEX idx_kb_lib_secrecy ON kb_library(secrecy);
CREATE INDEX idx_kb_lib_status ON kb_library(status);

-- ---------------------------------------------------------------------------
-- 3. 文档（kb_document）
-- ---------------------------------------------------------------------------
CREATE TABLE kb_document (
    id                 BIGINT PRIMARY KEY,
    library_id         BIGINT NOT NULL,
    title              VARCHAR(256) NOT NULL,
    engine_document_ref VARCHAR(128) NULL,           -- RAGFlow doc id（对外只认 MIS documentId）
    version            INT NOT NULL DEFAULT 1,
    parse_status       VARCHAR(16) NOT NULL DEFAULT 'pending',
    enabled            SMALLINT NOT NULL DEFAULT 1,
    size               BIGINT NULL,
    format             VARCHAR(16) NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_kb_doc_status CHECK (parse_status IN ('pending','parsing','success','failed'))
);
CREATE INDEX idx_kb_doc_lib ON kb_document(library_id);
CREATE INDEX idx_kb_doc_parse ON kb_document(parse_status);

-- ---------------------------------------------------------------------------
-- 4. 访问控制（kb_acl）：subject_id 复用 mis-iam/mis-org 主体 id
-- ---------------------------------------------------------------------------
CREATE TABLE kb_acl (
    id          BIGINT PRIMARY KEY,
    library_id  BIGINT NOT NULL,
    subject_type VARCHAR(8) NOT NULL,                -- user / role
    subject_id  BIGINT NOT NULL,                     -- 复用 mis-iam/mis-org 主体 id
    action      VARCHAR(8) NOT NULL,                 -- read / manage / acl
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_kb_acl UNIQUE (library_id, subject_type, subject_id, action),
    CONSTRAINT chk_kb_acl_subject CHECK (subject_type IN ('user','role')),
    CONSTRAINT chk_kb_acl_action CHECK (action IN ('read','manage','acl'))
);
CREATE INDEX idx_kb_acl_lib ON kb_acl(library_id);
CREATE INDEX idx_kb_acl_subject ON kb_acl(subject_type, subject_id);

-- ---------------------------------------------------------------------------
-- 5. 问答会话（kb_qa_session）
-- ---------------------------------------------------------------------------
CREATE TABLE kb_qa_session (
    id          BIGINT PRIMARY KEY,
    user_id     BIGINT NOT NULL,
    app_id      BIGINT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kb_qa_session_user ON kb_qa_session(user_id);

-- ---------------------------------------------------------------------------
-- 6. 问答消息（kb_qa_message）
-- ---------------------------------------------------------------------------
CREATE TABLE kb_qa_message (
    id          BIGINT PRIMARY KEY,
    session_id  BIGINT NOT NULL,
    role        VARCHAR(8) NOT NULL,                 -- user / assistant
    content     TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kb_qa_msg_session ON kb_qa_message(session_id);

-- ---------------------------------------------------------------------------
-- 7. 问答引用（kb_qa_citation）
-- ---------------------------------------------------------------------------
CREATE TABLE kb_qa_citation (
    id           BIGINT PRIMARY KEY,
    message_id   BIGINT NOT NULL,
    library_id   BIGINT NOT NULL,
    document_id  BIGINT NOT NULL,
    chunk_text   TEXT NULL,
    score        DOUBLE PRECISION NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kb_qa_citation_msg ON kb_qa_citation(message_id);
CREATE INDEX idx_kb_qa_citation_lib ON kb_qa_citation(library_id);

-- ---------------------------------------------------------------------------
-- 8. 问答反馈（kb_qa_feedback）：由前端→BFF→mis-kb 落库，可改一次
-- ---------------------------------------------------------------------------
CREATE TABLE kb_qa_feedback (
    id            BIGINT PRIMARY KEY,
    session_id    BIGINT NOT NULL,
    accuracy      SMALLINT NULL,     -- 1~5
    helpful       SMALLINT NULL,
    offtopic      SMALLINT NULL,
    cite_error    SMALLINT NULL,
    editable_once SMALLINT NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uk_kb_feedback_session UNIQUE (session_id)
);
CREATE INDEX idx_kb_qa_feedback_session ON kb_qa_feedback(session_id);

-- ---------------------------------------------------------------------------
-- 9. 问答工单（kb_qa_ticket）：P1 占位空表，仅建结构，逻辑留待 P1
-- ---------------------------------------------------------------------------
CREATE TABLE kb_qa_ticket (
    id          BIGINT PRIMARY KEY,
    session_id  BIGINT NULL,
    type        VARCHAR(16) NULL,
    status      VARCHAR(16) NULL DEFAULT 'open',
    content     TEXT NULL,
    handler_id  BIGINT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_kb_qa_ticket_session ON kb_qa_ticket(session_id);
