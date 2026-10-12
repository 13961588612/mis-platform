package com.mis.taskflow.dto;

import java.time.LocalDateTime;

/**
 * 门户「待办事项 · 全部」聚合行视图（三源 UNION，见
 * docs/design/portal-matters-aggregation-design.md §2.3）。
 *
 * <p>「全部」=「我相关的全部事项」= 两支的并集（字面保留重叠行，设计 §3.5）：
 * <ul>
 *   <li><b>kind=TASK</b>：{@code sys_task} 中分派给我的全部状态（PENDING/APPROVING/APPROVED/REJECTED）；</li>
 *   <li><b>kind=INSTANCE</b>：{@code wf_instance} 中我发起的。</li>
 * </ul>
 *
 * <p>字段供前端「全部」行渲染 + 抽屉转办使用；BFF 侧另有一份字段/顺序一致的镜像
 * （{@code com.mis.adminbff.client.model.PortalMatterVO}）。
 *
 * @param kind          行类型：{@code "TASK"} | {@code "INSTANCE"}（前端据此决定状态徽标口径）
 * @param id            TASK={@code sys_task.id}；INSTANCE={@code wf_instance.id}
 * @param instanceId    关联实例 id（TASK=经 {@code wf_task} 解析，无实例则 {@code null}；INSTANCE={@code = id}）
 * @param sysTaskId     TASK={@code sys_task.id}（供抽屉「转办」）；INSTANCE={@code null}
 * @param title         TASK={@code biz_title}；INSTANCE={@code business_type + ' / ' + business_id}
 * @param subtitle      TASK={@code biz_type + ' / ' + biz_ref_id}；INSTANCE={@code definition_code + ' · ' + coalesce(started_form_code,'-')}
 * @param bizType       业务类型（软引用 {@code biz_category.code}）；TASK={@code sys_task.biz_type}；INSTANCE={@code wf_instance.business_type}
 * @param appCode       应用归属（{@code sys_app.code}）；{@code null} = 平台级（前端显示「平台」）
 * @param initiatorName 所属实例发起人（TASK 无实例则 {@code null}）
 * @param assigneeName  TASK={@code sys_task.assignee_name}；INSTANCE={@code null}
 * @param status        TASK={@code sys_task.status}；INSTANCE={@code wf_instance.status}
 * @param createdAt     创建时间（TASK={@code sys_task.created_at}；INSTANCE={@code wf_instance.created_at}）
 * @param category      TASK=其 {@code status} 字面；INSTANCE={@code 'mySent'}（对齐既有 {@code fromWfInstance} 口径）
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
        String assigneeName,
        String status,
        LocalDateTime createdAt,
        String category
) {
}
