package com.mis.adminbff.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;

import java.util.LinkedHashSet;
import java.util.List;

/** 消息接收人并集。超过上限直接拒绝。 */
public final class MessageAudienceMerger {

    public static final int MAX_RECEIVERS = 5000;

    private MessageAudienceMerger() {
    }

    public static List<Long> merge(boolean all, List<Long> allUsers, List<Long> explicitUsers, List<Long> fromEmployees) {
        LinkedHashSet<Long> ids = new LinkedHashSet<>();
        if (all && allUsers != null) {
            ids.addAll(allUsers);
        }
        if (explicitUsers != null) {
            ids.addAll(explicitUsers);
        }
        if (fromEmployees != null) {
            ids.addAll(fromEmployees);
        }
        if (ids.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "没有可接收的启用用户");
        }
        if (ids.size() > MAX_RECEIVERS) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "接收人数超过 5000，请缩小范围");
        }
        return List.copyOf(ids);
    }
}
