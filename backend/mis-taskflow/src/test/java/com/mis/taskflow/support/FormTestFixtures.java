package com.mis.taskflow.support;

import com.mis.taskflow.domain.entity.FormDefinition;
import com.mis.taskflow.dto.UpsertFormDefinitionRequest;
import com.mis.taskflow.service.FormDefinitionService;

/**
 * 测试夹具：把 formCode 登记进 {@code form_definition}。
 *
 * <p>{@code WfDefinitionService.create/update} 自T1.5 起对 {@code supportedFormCodes}
 * 做权威校验（必须已注册、未软删、ENABLED），所以任何造流程定义的测试都得先把表单登记好。
 */
public final class FormTestFixtures {

    private FormTestFixtures() {
    }

    /** 登记一个启用中的表单；已存在则忽略（幂等，便于同一 code 在多个测试里复用）。 */
    public static String register(FormDefinitionService formService, Long tenantId, String code, String name) {
        if (formService.list(tenantId).stream().anyMatch(f -> code.equals(f.code()))) {
            return code;
        }
        formService.create(tenantId, 1L, new UpsertFormDefinitionRequest(
                FormDefinition.ROOT_PARENT_ID, code, name, null, FormDefinition.STATUS_ENABLED, 0, "{}"));
        return code;
    }
}