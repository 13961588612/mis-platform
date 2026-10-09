package com.mis.taskflow.dto;

import java.util.List;

/**
 * 流程实例详情（含任务与历史），用于 ProcessShell 渲染。
 */
public record ProcessDetailVO(
        WfInstanceVO instance,
        List<WfTaskVO> tasks,
        List<WfHistoryVO> history
) {
}
