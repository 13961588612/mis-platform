package com.mis.recon.domain.runtime;

import lombok.Builder;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * 比较结果（F55）：一致/不一致 + is_amount 差值（T05-spec §7）。
 */
@Data
@Builder
public class CompareResult {

    private boolean consistent;
    private List<Mismatch> mismatches;      // 不一致字段明细（consistent=false 时非空）
    private Long diffAmountCent;            // 第一个产生差异的 is_amount 字段差值（分，|left-right|）
    private Long diffPoint;                 // 第一个产生差异的 diff_unit=point 字段差值（原值整数，|left-right|，V5）
    private int comparedFields;             // 参与比较的规则数（诊断）

    public static CompareResult ok(int comparedFields) {
        return CompareResult.builder()
                .consistent(true)
                .mismatches(new ArrayList<>())
                .diffAmountCent(null)
                .diffPoint(null)
                .comparedFields(comparedFields)
                .build();
    }

    public static CompareResult fail(List<Mismatch> mismatches, Long diffAmountCent, int comparedFields) {
        return CompareResult.builder()
                .consistent(false)
                .mismatches(mismatches == null ? new ArrayList<>() : mismatches)
                .diffAmountCent(diffAmountCent)
                .comparedFields(comparedFields)
                .build();
    }
}
