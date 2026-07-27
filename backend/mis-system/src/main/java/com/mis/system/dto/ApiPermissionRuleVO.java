package com.mis.system.dto;

/**
 * 鉴权注册表单行（供 BFF 加载到内存 Registry）。
 * <p>{@code moduleStatus} 取自 sys_module.status：0=停用。Q4 方案下停用模块的接口规则仍保留，
 * 由 BFF 拦截器命中后据此返回 403。</p>
 */
public record ApiPermissionRuleVO(
        String httpMethod,
        String pathPattern,
        String permission,
        boolean authOnly,
        Integer moduleStatus
) {}
