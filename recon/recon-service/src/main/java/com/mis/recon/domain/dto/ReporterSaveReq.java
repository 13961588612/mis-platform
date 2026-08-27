package com.mis.recon.domain.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 报告渠道保存请求（T07-spec §7）。config_json 为渠道参数 JSONB（email 的收件人 / webhook 的 url）。
 */
@Data
public class ReporterSaveReq {

    @NotBlank(message = "场景编码必填")
    @Size(max = 64)
    private String scenarioCode;

    /** check 名；缺省 '*' = 该场景全部 check */
    @Size(max = 128)
    private String checkName;

    @NotBlank(message = "渠道必填")
    @Pattern(regexp = "email|webhook", message = "渠道仅支持 email / webhook")
    private String channel;

    @Size(max = 4096)
    private String configJson;

    /** info / warn / critical */
    @Size(max = 16)
    private String minSeverity;

    private Boolean enabled;
}