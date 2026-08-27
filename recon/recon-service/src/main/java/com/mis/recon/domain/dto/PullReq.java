package com.mis.recon.domain.dto;

import lombok.Data;

/**
 * 手动拉取请求（Ops F118）：start/end 可空（空 → PullRunner 窗口自动衔接，G4）。
 */
@Data
public class PullReq {
    /** "yyyy-MM-dd HH:mm:ss" */
    private String start;
    /** "yyyy-MM-dd HH:mm:ss" */
    private String end;
}
