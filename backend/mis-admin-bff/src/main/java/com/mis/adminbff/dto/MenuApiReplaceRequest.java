package com.mis.adminbff.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 菜单「关联 API」全量替换请求（镜像 mis-system MenuApiReplaceRequest）。
 * <p>apiIds 允许为空集合（等价于清空绑定）；非空时顺序即 sort 顺序。</p>
 */
public record MenuApiReplaceRequest(
        @NotNull List<Long> apiIds
) {}
