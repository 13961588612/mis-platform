package com.mis.aireport.domain.param;

import java.util.Map;

/**
 * 参数来源编码规范化：V163 起超市槽位加 {@code spm_} 前缀；兼容旧 slots_json。
 */
public final class ParamSourceCodes {

    private static final Map<String, String> LEGACY_TO_CANONICAL = Map.of(
            "auth_store", "spm_auth_store",
            "cal_biz_date", "spm_cal_biz_date",
            "cal_ord_week", "spm_cal_ord_week",
            "cal_ord_month", "spm_cal_ord_month");

    private ParamSourceCodes() {
    }

    /** 将槽位里的 source_code 规范为当前库中的编码。 */
    public static String canonical(String sourceCode) {
        if (sourceCode == null) {
            return "";
        }
        String code = sourceCode.trim();
        return LEGACY_TO_CANONICAL.getOrDefault(code, code);
    }
}
