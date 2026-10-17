package com.mis.taskflow.formstore;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 按 formCode 解析 {@link FormStructuredStore}；未注册则禁止保存/发起。
 */
@Component
public class FormStructuredStoreRegistry {

    private final Map<String, FormStructuredStore> byCode;

    public FormStructuredStoreRegistry(List<FormStructuredStore> stores) {
        this.byCode = stores.stream()
                .collect(Collectors.toMap(FormStructuredStore::formCode, Function.identity(), (a, b) -> {
                    throw new IllegalStateException("重复 FormStructuredStore: " + a.formCode());
                }));
    }

    public FormStructuredStore require(String formCode) {
        if (formCode == null || formCode.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "formCode 不能为空");
        }
        FormStructuredStore store = byCode.get(formCode.trim());
        if (store == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "表单未注册结构化存储: " + formCode.trim() + "（需 FormStructuredStore + 专用宽表）");
        }
        return store;
    }

    public boolean supports(String formCode) {
        return formCode != null && byCode.containsKey(formCode.trim());
    }
}
