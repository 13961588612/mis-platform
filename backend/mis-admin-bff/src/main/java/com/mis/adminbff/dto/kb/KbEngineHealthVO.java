package com.mis.adminbff.dto.kb;

/**
 * 引擎连通性健康视图（S-04），字段与 mis-kb {@code EngineHealth} + 引擎类型对齐。
 *
 * @param engineType 当前生效的引擎类型（ragflow/noop/mock）
 * @param healthy    是否连通
 * @param status     UP / DOWN
 * @param detail     诊断信息（失败原因或可达说明）
 */
public record KbEngineHealthVO(
        String engineType,
        Boolean healthy,
        String status,
        String detail) {
}
