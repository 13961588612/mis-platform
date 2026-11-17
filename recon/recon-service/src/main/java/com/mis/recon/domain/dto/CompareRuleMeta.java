package com.mis.recon.domain.dto;

import lombok.Data;

/**
 * 比较规则元信息（V4 详情页前端识别金额字段用）。
 * 与 CompareEngine.RuleConfig 对应，仅保留前端展示/金额字段识别所需字段。
 */
@Data
public class CompareRuleMeta {

    /** 规则名（描述用） */
    private String name;

    /** 左侧字段，格式 "ds.field" */
    private String leftField;

    /** 右侧字段，格式 "ds.field" */
    private String rightField;

    /** 比较模式：equal/lte/gte/lt/gt/contains/regex */
    private String compareMode;

    /** 是否金额字段（前端高亮 + 单位说明） */
    private boolean isAmount;

    /** 值归一：none/trim_comma/trim/uppercase/trim_space/lower */
    private String valueTransform;
}
