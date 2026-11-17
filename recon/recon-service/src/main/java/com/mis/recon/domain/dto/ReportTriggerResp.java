package com.mis.recon.domain.dto;

import lombok.Data;

/**
 * 手动触发报告响应（T07-spec §9）。
 */
@Data
public class ReportTriggerResp {

    private long reportRunId;

    private int diffCount;

    /** success / failed / partial */
    private String sendStatus;
}