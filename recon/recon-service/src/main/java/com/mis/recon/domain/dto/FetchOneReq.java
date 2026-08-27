package com.mis.recon.domain.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.Data;

/**
 * 单条重拉请求（OpsController 试拉端点用）：按 dsCode + recordKey。
 */
@Data
public class FetchOneReq {

    @NotBlank(message = "record_key 必填")
    private String recordKey;
}
