package com.mis.adminbff.dto;

public record AppView(
        String id,
        String tenantId,
        String code,
        String name,
        String icon,
        String basePath,
        String description,
        String portalGroup,
        String kind,
        String runtime,
        Integer sort,
        Integer status,
        boolean enterable,
        /** 该应用声明仅内网；门户仍展示卡片，非内网客户端 enterable=false。 */
        boolean intranetOnly,
        /** micro-app / iframe 子应用入口 HTML 地址（sys_app.mfe_remote） */
        String entry
) {}
