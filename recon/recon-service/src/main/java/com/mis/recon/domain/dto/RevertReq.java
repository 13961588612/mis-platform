package com.mis.recon.domain.dto;

import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 回退为未处理请求（V4）。
 */
@Data
public class RevertReq {

    @Size(max = 64)
    private String operator;

    @Size(max = 1024)
    private String remark;
}
