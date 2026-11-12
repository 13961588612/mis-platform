package com.mis.adminbff.client.model;

/**
 * 流程边 DTO（设计器连线），字段与 mis-taskflow 的 {@code WfEdgeDTO} 一一对应。
 *
 * <p>⚠️ {@code source}/{@code target} 存的是 **nodeCode**（如 {@code start}），
 * 不是设计器画布 id（{@code n_start}）—— 前端 {@code designer-body.tsx} 负责双向加/去 {@code n_} 前缀。
 *
 * <p>本 record 存在的唯一理由：{@link WfDefinitionDTO} 少了 {@code edges} 分量时，
 * Spring Boot 默认 {@code FAIL_ON_UNKNOWN_PROPERTIES=false} 会<b>静默丢弃</b>下游返回的
 * {@code edges} 数组 ⇒ 编排页读不到任何连线。
 *
 * @param source       起点节点 nodeCode
 * @param target       终点节点 nodeCode
 * @param edgeType     边类型（DEFAULT / CONDITION_YES / CONDITION_NO）
 * @param label        连线标签（可空）
 * @param conditionExpr条件表达式（可空）
 * @param sortOrder    同definition 内排序
 */
public record WfEdgeDTO(
        String source,
        String target,
        String edgeType,
        String label,
        String conditionExpr,
        Integer sortOrder
) {
}