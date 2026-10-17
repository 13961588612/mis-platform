package com.mis.adminbff.dto;

import java.util.List;

/**
 * 后台发消息 / 预览人数。范围可多选，按并集。
 */
public record MessageSendRequest(
        String title,
        String summary,
        String contentHtml,
        List<Long> attachmentFileIds,
        boolean all,
        List<Long> userIds,
        List<Long> deptIds,
        List<Long> postTypeIds,
        List<ScopeCondition> scopes
) {
    /** 一条接收条件：该部门（含子部门）且该岗位类型（含下级）。 */
    public record ScopeCondition(Long deptId, Long postTypeId, String deptName, String postTypeName) {
    }
}
