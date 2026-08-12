package com.mis.system.dto;

import jakarta.validation.constraints.NotNull;

import java.util.List;

/**
 * 菜单「关联 API」全量替换请求。
 * <p>apiIds 允许为空集合（等价于清空绑定）；非空时顺序即 sort 顺序（1..n）。
 * 使用 {@link NotNull} 而非 {@code @NotEmpty}，明确允许空集合语义。</p>
 */
public record MenuApiReplaceRequest(
        @NotNull List<Long> apiIds
) {}
