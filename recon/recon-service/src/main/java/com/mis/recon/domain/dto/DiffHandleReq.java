package com.mis.recon.domain.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 差异人工处理请求（T07-spec §6 G30）。handle_status ∈ handled/ignored/false_positive。
 */
@Data
public class DiffHandleReq {

    @NotBlank(message = "处理状态必填")
    @Pattern(regexp = "handled|ignored|false_positive",
            message = "处理状态仅支持 handled / ignored / false_positive")
    private String handleStatus;

    @Size(max = 64)
    private String operator;

    @Size(max = 1024)
    private String remark;
}