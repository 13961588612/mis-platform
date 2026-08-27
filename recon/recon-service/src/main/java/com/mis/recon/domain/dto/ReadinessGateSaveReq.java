package com.mis.recon.domain.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 数据就绪门保存请求（T07-§7. ReadinessGate CRUD）。
 * gate_type ∈ flag_query/row_count_delta/app_callback/stability_window（T06 引擎已支持前三种 + 降级）。
 */
@Data
public class ReadinessGateSaveReq {

    @NotBlank(message = "场景编码必填")
    @Size(max = 64)
    private String scenarioCode;

    @NotBlank(message = "就绪门名称必填")
    @Size(max = 128)
    private String gateName;

    @NotBlank(message = "就绪门类型必填")
    @Pattern(regexp = "flag_query|row_count_delta|app_callback|stability_window",
            message = "就绪门类型仅支持 flag_query / row_count_delta / app_callback / stability_window")
    private String gateType;

    @Size(max = 8192)
    private String gateSql;

    @Size(max = 8192)
    private String gateConfigJson;

    @Min(0)
    private Integer minWaitMin;

    @Min(0)
    @Max(10080)
    private Integer maxWaitMin;

    private Boolean enabled;
}