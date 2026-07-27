package com.mis.adminbff.dto;

public record ModuleApiBindingVO(
        String menuId,
        String menuName,
        String permission,
        String apiId,
        String apiName,
        String httpMethod,
        String pathPattern
) {}
