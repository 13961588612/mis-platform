package com.mis.recon.domain.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

import java.util.Map;

/**
 * 试拉（BR-18，需求说明书 §3.3）响应：连接成功 + 最近 1 条样例 + 字段数。
 */
@Data
@AllArgsConstructor
public class ProbeResp {
    private boolean connected;
    private int fieldCount;
    private Map<String, Object> sampleRow;
    private String message;
}
