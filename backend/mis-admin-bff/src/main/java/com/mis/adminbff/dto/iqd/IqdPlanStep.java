package com.mis.adminbff.dto.iqd;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 问数计划步骤（与 Python {@code models/iqd_schema.py::PlanStep} 同构，§4.3）。
 *
 * @param seq        步骤序号（1-based）
 * @param code       步骤码（scope_check / understanding / searching / generating /
 *                   lineage_check / executing / masking / finished）
 * @param label      展示标签
 * @param detail     详情（可空）
 * @param sql        SQL（view=user 时由 Worker 投影剥键；BFF 侧不持有）
 * @param status     pending / running / done / error / skipped
 * @param durationMs 耗时（毫秒；可空）
 */
public record IqdPlanStep(
        Integer seq,
        String code,
        String label,
        String detail,
        String sql,
        String status,
        @JsonProperty("duration_ms") Long durationMs) {
}
