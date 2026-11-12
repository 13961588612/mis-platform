package com.mis.adminbff.client.model;

import java.time.LocalDateTime;

/**
 * 门户「待办事项 · 全部」聚合行视图（BFF 侧镜像）。
 *
 * <p>字段名与顺序<b>严格对齐</b> mis-taskflow 的
 * {@code com.mis.taskflow.dto.PortalMatterVO}（Jackson 反序列化按字段名绑定，
 * 字段缺失会静默为 {@code null}），见
 * docs/design/portal-matters-aggregation-design.md §2.3。
 *
 * @param kind          行类型：{@code "TASK"} | {@code "INSTANCE"}
 * @param id            TASK={@code sys_task.id}；INSTANCE={@code wf_instance.id}
 * @param instanceId    关联实例 id（无则 {@code null}）
 * @param sysTaskId     TASK={@code sys_task.id}（抽屉「转办」用）；INSTANCE={@code null}
 * @param title         主标题
 * @param subtitle      副标题
 * @param bizType       业务类型（软引用 {@code biz_category.code}）
 * @param appCode       应用归属（{@code null} = 平台级）
 * @param initiatorName    所属实例发起人
 * @param initiatorOrgName 发起人所属组织/公司名
 * @param assigneeName     处理人（TASK）
 * @param status           状态
 * @param createdAt        创建时间
 * @param category         分类（TASK={@code status} 字面；INSTANCE={@code 'mySent'}）
 */
public record PortalMatterVO(
        String kind,
        String id,
        String instanceId,
        String sysTaskId,
        String title,
        String subtitle,
        String bizType,
        String appCode,
        String initiatorName,
        String initiatorOrgName,
        String assigneeName,
        String status,
        LocalDateTime createdAt,
        String category
) {
}
