package com.mis.taskflow.dto;

import java.util.List;

/**
 * 流程实例详情（含任务与历史），用于 ProcessShell 渲染。
 *
 * @param instance  实例概要
 * @param tasks     待办/已完成任务
 * @param history   审批历史
 * @param formData  本次发起提交的业务表单数据（{@code wf_instance.form_data} 原样透出，JSON 串）。
 *                  <p>⚠️ 只在 detail 接口填，<b>刻意不进 {@link WfInstanceVO}</b>：
 *                  {@code GET /workflow/instances/my} 分页 20 条，若挂在 instance 上会多传 20 份表单 JSON。
 *                  <p>原样透出（不做解析/裁剪）：前端按 JSON 容错解析，失败降级为原文展示。
 */
public record ProcessDetailVO(
        WfInstanceVO instance,
        List<WfTaskVO> tasks,
        List<WfHistoryVO> history,
        String formData
) {
}