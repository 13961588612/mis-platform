package com.mis.system.dto;

public record ApiPermissionRuleVO(
        String httpMethod,
        String pathPattern,
        String permission,
        boolean authOnly
) {}
