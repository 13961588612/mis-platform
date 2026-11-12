package com.mis.aireport.domain.param;

import java.util.List;

public record ParamResolveResult(
        String sourceCode,
        String valueType,
        String wireKey,
        String label,
        List<ParamOption> options,
        String defaultValue) {
}
