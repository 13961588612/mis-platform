-- V113: iqd table acl ask-only object model
ALTER TABLE iqd_table_acl ADD COLUMN IF NOT EXISTS object_type VARCHAR(16) NULL;
ALTER TABLE iqd_table_acl ADD COLUMN IF NOT EXISTS object_key VARCHAR(512) NULL;
ALTER TABLE iqd_table_acl ADD COLUMN IF NOT EXISTS field_key VARCHAR(512) NULL;

UPDATE iqd_table_acl
SET object_type = CASE
    WHEN item_key LIKE 'mdl:model:%' THEN 'model'
    WHEN item_key LIKE 'mdl:cube:%' THEN 'cube'
    ELSE 'table'
END,
object_key = item_key,
field_key = NULL
WHERE object_key IS NULL OR object_type IS NULL;

UPDATE iqd_table_acl SET action = 'ask' WHERE action IS NULL OR action <> 'ask';
ALTER TABLE iqd_table_acl ALTER COLUMN action SET DEFAULT 'ask';
CREATE INDEX IF NOT EXISTS idx_iqd_table_acl_object ON iqd_table_acl(connection_id, object_type, object_key, field_key, action);
