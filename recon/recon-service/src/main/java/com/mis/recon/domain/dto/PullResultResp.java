package com.mis.recon.domain.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

/**
 * 拉取结果摘要（Ops F118 响应）。
 */
@Data
@AllArgsConstructor
public class PullResultResp {
    private long pullRunId;
    private String status;
    private String healthStatus;
    private int rowCount;
}
