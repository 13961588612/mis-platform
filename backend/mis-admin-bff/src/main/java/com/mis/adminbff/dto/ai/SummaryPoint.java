package com.mis.adminbff.dto.ai;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 摘要结构化要点（T-sum）。
 *
 * <p>{@code label} / {@code value} / {@code risk} 为平台结构化输出；{@code risk} ∈
 * {@code low | medium | high}（由平台 prompt 直出，BFF 仅透传）。{@code text} 兼容旧
 * {@code List<String>} 形态的纯文本要点（平台返回字符串数组时映射为 {@code text}）。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SummaryPoint {

    /** 要点标签，如「金额」「审批人」。 */
    private String label = "";

    /** 要点取值，如「12800」「李四」。 */
    private String value = "";

    /** 风险等级枚举：low | medium | high。 */
    private String risk = "";

    /** 兼容旧 List<String> 形态的纯文本要点；结构化要点亦回填为「label: value」。 */
    private String text = "";

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public String getValue() {
        return value;
    }

    public void setValue(String value) {
        this.value = value;
    }

    public String getRisk() {
        return risk;
    }

    public void setRisk(String risk) {
        this.risk = risk;
    }

    public String getText() {
        return text;
    }

    public void setText(String text) {
        this.text = text;
    }
}
