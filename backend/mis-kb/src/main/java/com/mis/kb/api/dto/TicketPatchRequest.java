package com.mis.kb.api.dto;

import jakarta.validation.constraints.Size;

/**
 * 工单处理/关闭请求（A-02c）。
 *
 * <p>全部字段可空——PATCH 语义：只更新显式传入的字段。{@code status} 为空表示仅补备注不流转状态。
 *
 * @param status      目标状态码值（open/processing/resolved/closed）
 * @param note        处理备注
 * @param relAction   关联动作码值
 * @param processorId 处理人 userId；为空时由服务端用当前登录用户填充
 */
public record TicketPatchRequest(
        String status,
        @Size(max = 2000) String note,
        String relAction,
        Long processorId) {
}
