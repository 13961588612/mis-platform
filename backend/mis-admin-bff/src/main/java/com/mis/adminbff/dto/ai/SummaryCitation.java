package com.mis.adminbff.dto.ai;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * 摘要引用溯源（T-sum）。
 *
 * <p>{@code field} = 前端 {@code AdminField.key}（表单字段真源）；{@code source} 约定为
 * {@code <表名>.<字段名>}（如 {@code 报销单主表.amount}）。{@code value} 为引用值。
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public class SummaryCitation {

    /** 引用对应的前端表单字段 key（AdminField.key）。 */
    private String field = "";

    /** 引用值。 */
    private String value = "";

    /** 引用来源，约定格式 <表名>.<字段名>。 */
    private String source = "";

    public String getField() {
        return field;
    }

    public void setField(String field) {
        this.field = field;
    }

    public String getValue() {
        return value;
    }

    public void setValue(String value) {
        this.value = value;
    }

    public String getSource() {
        return source;
    }

    public void setSource(String source) {
        this.source = source;
    }
}
