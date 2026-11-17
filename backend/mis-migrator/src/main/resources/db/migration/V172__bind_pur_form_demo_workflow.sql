-- V172：测试表单「新建单据」依赖 form_definition LOCAL 绑定
-- V149 把关联迁到表单侧并清空 wf_definition.supported_form_codes；
-- 若 PUR_FORM 仍是 NONE，反查为空，联调页 boundOptions=0。
-- PostgreSQL 16 | 幂等

UPDATE form_definition f
SET workflow_binding_type = 'LOCAL',
    workflow_definition_id = d.id,
    external_workflow_system = NULL,
    external_workflow_ref = NULL,
    updated_at = NOW()
FROM wf_definition d
WHERE f.tenant_id = d.tenant_id
  AND f.code = 'PUR_FORM'
  AND f.deleted = 0
  AND f.status = 'ENABLED'
  AND f.workflow_binding_type = 'NONE'
  AND d.code = 'PURCHASE_APPROVAL_DEMO'
  AND d.deleted = 0;
