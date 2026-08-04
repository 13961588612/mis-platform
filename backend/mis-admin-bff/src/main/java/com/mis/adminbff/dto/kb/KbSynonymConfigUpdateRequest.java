package com.mis.adminbff.dto.kb;

import jakarta.validation.constraints.NotNull;

/**
 * 同义词全局开关切换请求（BFF 侧镜像）。
 *
 * <p>Wave D 新增。<b>只含 {@code enabled} 一个字段</b>：
 * Nacos 熔断闸 {@code killSwitchEnabled} 与四个预算值都是运维侧配置，
 * 页面只读。若在这里开一个写口，「熔断闸」就名存实亡了——
 * 业务侧一键关掉运维的兜底开关，这个开关就不叫兜底。
 *
 * <p>用包装类型 {@code Boolean} 而非 {@code boolean} 配合 {@code @NotNull}：
 * 原始类型收不到 {@code null}，缺字段会被 Jackson 静默填成 {@code false}，
 * 「没传」与「传了 false」变成同一件事——切开关这种操作，这种含糊是不可接受的。
 *
 * @param enabled 目标状态；必填
 */
public record KbSynonymConfigUpdateRequest(
        @NotNull(message = "enabled 不能为空") Boolean enabled) {

    /**
     * 拆箱后的开关值。
     *
     * @return {@code true} 表示开
     */
    public boolean enabledValue() {
        return Boolean.TRUE.equals(enabled);
    }
}
