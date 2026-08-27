package com.mis.recon.domain.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 数据源保存请求（F49），字段与实体 ReconDatasource 一一对应。
 */
@Data
public class DatasourceSaveReq {

    @NotBlank(message = "数据源编码必填")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "数据源编码须为 snake_case，≤64 字符")
    private String dsCode;

    @NotBlank(message = "名称必填")
    @Size(max = 128)
    private String name;

    @Size(max = 64)
    private String connCode;

    @Size(max = 64)
    private String pullCron;

    @NotBlank(message = "记录键表达式必填")
    @Size(max = 256)
    private String recordKeyExpression;

    @Size(max = 64)
    private String timeField;

    private String fetchType;

    private String fetchConfigJson;

    private String fieldsJson;

    private String healthRulesJson;

    private String amountFieldsJson;

    private String refundSignRule;

    @Size(max = 200)
    private String refundFlagExpr;

    private String grain;

    @Size(max = 256)
    private String groupByFields;

    @Size(max = 64)
    private String memberKeyField;

    private String keyScanSql;

    private String aggSql;

    @Min(1)
    @Max(1000)
    private Integer aggKeyBatchSize;

    private String aggJoinMode;

    @Size(max = 64)
    private String aggFullRecomputeCron;

    private Boolean mixedDirection;

    @Size(max = 64)
    private String directionKeyField;

    private String keyCaseMode;

    private String deleteMode;

    @Size(max = 200)
    private String softDeleteExpr;

    @Size(max = 200)
    private String deleteModeEvidence;

    private Boolean enabled;
}
