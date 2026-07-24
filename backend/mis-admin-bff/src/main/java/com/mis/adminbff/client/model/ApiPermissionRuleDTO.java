package com.mis.adminbff.client.model;

public record ApiPermissionRuleDTO(
        String httpMethod,
        String pathPattern,
        String permission,
        boolean authOnly
) {
}
