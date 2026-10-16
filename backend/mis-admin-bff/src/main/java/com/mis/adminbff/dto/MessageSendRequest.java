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
        List<Long> postTypeIds
) {
}
