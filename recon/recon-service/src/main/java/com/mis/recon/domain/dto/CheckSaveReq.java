package com.mis.recon.domain.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.Data;

/**
 * 检查保存请求（F51，G8 嵌套对象）：check 本体 + 匹配规则 + 比较规则三表聚合。
 * consume_json 行结构 {alias:{ds_code, mode, time_field?, start?, end?}}（G13）。
 */
@Data
public class CheckSaveReq {

    @NotBlank(message = "场景编码必填")
    @Pattern(regexp = "^[a-z][a-z0-9_]{0,63}$", message = "场景编码须为 snake_case，≤64 字符")
    private String scenarioCode;

    @NotBlank(message = "检查名必填")
    @Size(max = 128)
    private String checkName;

    private Integer seqNo;

    private String consumeJson;

    private String runMode;

    private Boolean enabled;

    /** 汇总窗口（存在 time_window 数据源时必填，保存时自动回写行内 start/end） */
    private String windowStart;

    private String windowEnd;

    @Valid
    private MatchRuleReq matchRule;

    @Valid
    private CompareRuleReq compareRule;

    @Data
    public static class MatchRuleReq {
        @NotBlank(message = "匹配策略必填")
        private String strategy;
        private String datasetsJson;
        private String keyFieldsJson;
        private String fieldTransformJson;
        private String multiRowJson;
        @Size(max = 256)
        private String customClass;
        private String configJson;
    }

    @Data
    public static class CompareRuleReq {
        private String rulesJson;
    }
}
