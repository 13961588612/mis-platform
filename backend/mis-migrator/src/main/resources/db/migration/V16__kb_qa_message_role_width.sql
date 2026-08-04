-- 修复 kb_qa_message.role 列宽不足:合法值 user(4)/assistant(9) 超出原 VARCHAR(8)
-- 扩至 VARCHAR(16) 以容纳 assistant 并留余量
ALTER TABLE kb_qa_message ALTER COLUMN role TYPE VARCHAR(16);
