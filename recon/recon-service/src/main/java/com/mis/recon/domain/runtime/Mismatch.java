package com.mis.recon.domain.runtime;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 不一致字段明细（F55 附属，诊断 compare_phase.mismatches 项）。
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Mismatch {

    private String field;        // 规则名（rules_json.name，空则"左字段 vs 右字段"）
    private String leftValue;    // 左侧台账原始值
    private String rightValue;   // 右侧台账原始值
    private String tolerance;    // 容差描述（如 "absolute:1" / "percentage:0.01" / "null"）
    private String eqRule;       // compare_mode 名（equal/lte/...）
}
