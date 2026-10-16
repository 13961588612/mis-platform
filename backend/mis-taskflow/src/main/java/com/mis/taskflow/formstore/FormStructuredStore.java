package com.mis.taskflow.formstore;

import java.util.Map;

/**
 * 表单专用宽表读写 SPI：一 {@code formCode} 一实现，禁止通用 EAV。
 */
public interface FormStructuredStore {

    /** 前端/注册表 formCode，如 {@code PUR_FORM}。 */
    String formCode();

    /** 物理表名，如 {@code biz_form_pur_form}。 */
    String storageTable();

    /** 插入宽表行，返回 dataId。 */
    Long save(Long tenantId, Long operatorId, Map<String, Object> values);

    /** 更新宽表行（仅单据可写态由上层守卫）。 */
    void update(Long tenantId, Long dataId, Map<String, Object> values);

    /** 回填编辑页。 */
    Map<String, Object> load(Long tenantId, Long dataId);

    /** 发起流程时写入 {@code wf_instance.form_data} 的 JSON 快照。 */
    String toSnapshot(Long tenantId, Long dataId);

    /** 反填 form_record_id（可选）。 */
    default void bindFormRecord(Long tenantId, Long dataId, Long formRecordId) {
        // no-op
    }
}
