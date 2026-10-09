package com.mis.taskflow.dto;

import jakarta.validation.constraints.NotEmpty;

import java.util.List;

/**
 * 批量标记已读。
 */
public record MarkReadRequest(@NotEmpty List<Long> ids) {
}