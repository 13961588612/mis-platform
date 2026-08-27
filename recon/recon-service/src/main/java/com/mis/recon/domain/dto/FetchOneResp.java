package com.mis.recon.domain.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

/**
 * fetch_one 响应（Ops F118）。
 */
@Data
@AllArgsConstructor
public class FetchOneResp {
    private boolean found;
    private String recordKey;
}
