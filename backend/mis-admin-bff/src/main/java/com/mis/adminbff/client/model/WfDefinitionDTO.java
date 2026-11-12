package com.mis.adminbff.client.model;

import java.time.LocalDateTime;
import java.util.List;

/**
 * 流程定义 BFF 视图。字段顺序/命名必须与 mis-taskflow 的 {@code WfDefinitionDTO} <b>严格对齐</b>。
 *
 * <p>⚠️ <b>不要删 {@code edges} 分量</b>（回归钉子，见
 * {@code TaskflowWebClientWorkflowEdgeTest}）：本 record 曾经漏掉 {@code edges}，
 * 而 Spring Boot 默认 {@code FAIL_ON_UNKNOWN_PROPERTIES=false}，
 * 于是 mis-taskflow明明返回了 {@code wf_edge} 里的连线，BFF 反序列化时<b>静默丢弃</b>，
 * 前端 {@code fetchDefinition} 拿到 {@code undefined} ⇒「编排页节点都在但一条连线都没有」。
 *
 * <p>同类型的静默丢弃坑还有 {@link WfNodeDTO}：新增下游字段时若不同步本层，
 * 就会重演同样的「下游有、前端空」。凡是 taskflow 定义详情有的分量，本 record 都必须有。
 *
 * @param categoryId 流程分类 id（V131 起指向 wf_category.id，可空；旧 category 列保留废弃）
 */
public record WfDefinitionDTO(
        String id, String tenantId, String code, String name, String category, String description,
        Integer version, String status, List<String> supportedFormCodes, String formSchema, String config,
        List<WfNodeDTO> nodes, List<WfEdgeDTO> edges,
        LocalDateTime createdAt, LocalDateTime updatedAt, Long categoryId) {
}