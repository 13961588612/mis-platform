package com.mis.recon.domain.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 场景保存请求（F50）。uses_json 为派生汇总，不接收（由 CheckService 回写，G12）。
 */
@Data
public class ScenarioSaveReq {

    @NotBlank(message = "场景编码必填")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "场景编码须为 snake_case，≤64 字符")
    private String scenarioCode;

    @NotBlank(message = "名称必填")
    @Size(max = 128)
    private String name;

    @Size(max = 64)
    private String cronExpr;

    private String hooksJson;

    private String reporterJson;

    @Size(max = 64)
    private String reportCron;

    private String reportType;

    @Min(0)
    private Integer poolMaxAgeDays;

    @Min(0)
    private Integer pendingMaxWaitHours;

    private String onDegraded;

    private String onEmpty;

    private String onError;

    private Boolean enabled;
}
