package com.mis.taskflow.dto;

import java.util.List;

/**
 * 仅更新流程定义的表单关联（白名单）。
 *
 * <p>与全量 {@link CreateDefinitionRequest} 分离：关联表单可在草稿/已发布状态下独立调整，
 * 不必走「取消发布 → 改画布 → 再发布」。
 */
public record UpdateSupportedFormsRequest(List<String> supportedFormCodes) {
}
