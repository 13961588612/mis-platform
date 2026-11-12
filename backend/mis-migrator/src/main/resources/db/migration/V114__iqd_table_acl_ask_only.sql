-- V114: iqd_table_acl is repurposed to row-level scope only (Option A).
-- Grant authority lives entirely in iqd_scope_policy; the ACL table keeps just `row_scope`.
-- The `manage` action is dead (never written by code, never read by the resolver), so we
-- collapse the legacy check constraint to ask-only.
UPDATE iqd_table_acl SET action = 'ask' WHERE action IS NULL OR action <> 'ask';
ALTER TABLE iqd_table_acl DROP CONSTRAINT IF EXISTS chk_iqd_table_acl_action;
ALTER TABLE iqd_table_acl ADD CONSTRAINT chk_iqd_table_acl_action CHECK (action = 'ask');
