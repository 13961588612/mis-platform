package com.mis.adminbff.client.model;

import java.util.List;

/**
 * 流程实例详情（透传 mis-taskflow 的 ProcessDetailVO）。
 *
 * <p>{@code formData} 详情接口始终返回；列表 {@code WfInstanceVO.formData}
 * 仅 {@code includeFormData=true} 时填充。
 */
public record ProcessDetailVO(
        WfInstanceVO instance, List<WfTaskVO> tasks, List<WfHistoryVO> history, String formData) {
}