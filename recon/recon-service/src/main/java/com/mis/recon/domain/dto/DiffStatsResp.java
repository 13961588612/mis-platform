package com.mis.recon.domain.dto;

import lombok.Data;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 差异统计条响应（T05-spec §11 F117）：
 * totalUnhandled / totalConfirmedUnhandled / amountCentTotal(分) / diffTypeRatio。
 */
@Data
public class DiffStatsResp {

    /** 未处理总数：status IN (pending,confirmed) AND handle_status='unhandled' */
    private long totalUnhandled;

    /** 其中已确认未处理：status=confirmed AND handle_status='unhandled' */
    private long totalConfirmedUnhandled;

    /** 金额合计（分，前端 ÷100 转元）：未处理口径 SUM(diff_amount_cent) */
    private long amountCentTotal;

    /** 未处理差异按 diff_type 计数占比：{field_mismatch: n, unmatched_left: n, ...} */
    private Map<String, Long> diffTypeRatio = new LinkedHashMap<>();
}
