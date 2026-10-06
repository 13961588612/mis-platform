package com.mis.adminbff.dto.iqd;

import java.util.List;

/** 行级维度值解析结果（MIS 值 → 数仓外部编码）。 */
public record IqdDimensionResolveVO(
        List<String> resolved,
        List<String> dropped,
        boolean empty) {
}
