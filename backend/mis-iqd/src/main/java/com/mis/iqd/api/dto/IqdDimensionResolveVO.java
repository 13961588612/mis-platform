package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.List;

/**
 * 行级维度值解析结果（MIS 值 → 数仓外部编码）。
 *
 * <p>{@code resolved} 为最终限制范围（去重后 external 编码）；
 * {@code dropped} 为「在映射里找不到、按语义丢弃」的 MIS 值（store 无权限 / dept 子树无映射）。
 * {@code empty} = resolved 为空（调用方按 45204 fail-closed 处理）。
 */
public record IqdDimensionResolveVO(
        @JsonProperty("connection_id") Long connectionId,
        @JsonProperty("dimension_code") String dimensionCode,
        List<String> resolved,
        List<String> dropped,
        boolean empty) {
}
