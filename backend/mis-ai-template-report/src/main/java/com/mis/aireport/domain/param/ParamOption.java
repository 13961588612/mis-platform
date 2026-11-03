package com.mis.aireport.domain.param;

import java.util.Map;

/** 参数选项（prepare-card / catalog 回传前端）。 */
public record ParamOption(String value, String label, Map<String, Object> extra) {

    public ParamOption(String value, String label) {
        this(value, label, Map.of());
    }
}
