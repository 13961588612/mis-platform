package com.mis.adminbff.client.model;

import java.util.List;

/**
 * 流程实例详情（透传 mis-taskflow 的 ProcessDetailVO）。
 *
 * <p>{@code formData} 只在 detail 接口返回；{@code WfInstanceVO} 不含该字段，
 * 所以列表接口 {@code /workflow/instances/my} 不会带上表单 JSON。
 */
public record ProcessDetailVO(
        WfInstanceVO instance, List<WfTaskVO> tasks, List<WfHistoryVO> history, String formData) {
}