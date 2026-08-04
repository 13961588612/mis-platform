package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotNull;

/**
 * 切换同义词全局开关的请求（Wave D · T09，WD-07 / AC-02）。
 *
 * <p><b>只有一个字段，且只能是库内业务开关。</b>Nacos 熔断闸
 * {@code mis.kb.synonym.enabled} <b>不在这里</b>，也永远不会在这里——
 * 它属于运维通道（改配置中心），页面只读。若把它做成可写字段，
 * 就等于把「熔断」这个最后手段的控制权交给了业务页面，
 * 那么熔断本身也就失去了意义（出事时正是业务侧最可能误操作的时刻）。
 *
 * <p>{@code enabled} 用包装类型 {@code Boolean} + {@code @NotNull} 而不是原始
 * {@code boolean}：后者在字段缺失时会静默变成 {@code false}，
 * 一个拼错字段名的请求就会把全局同义词悄悄关掉，且返回 200。
 *
 * @param enabled 目标状态（必填）
 */
public record SynonymConfigUpdateRequest(
        @NotNull(message = "enabled 不能为空") Boolean enabled) {

    /**
     * 目标状态的原始布尔值。
     *
     * @return {@code true} 表示开启；{@code null} 已被校验挡住，此处防御性回落 {@code false}
     */
    public boolean enabledValue() {
        return Boolean.TRUE.equals(enabled);
    }
}
