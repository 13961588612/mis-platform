package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * 保存配置文件内容入参（§4.3 #24，对应前端 {@code types.ts:SaveConfigFilePayload}）。
 *
 * <p>{@code baseSha256} <b>必填</b>：它是并发保护的唯一依据。若允许缺省并在服务端
 * 「没传就不校验」，那么任何一个忘记带这个字段的客户端都会自动获得
 * 「无条件覆盖」的能力 —— 保护机制变成可选项就等于没有保护。
 *
 * <p>{@code content} 用 {@code @NotNull} 而非 {@code @NotBlank}：把一个配置文件
 * 清空成空内容是合法操作（例如清掉一份临时的 prompt 覆盖）。
 * 用 {@code @NotBlank} 会把这个正常需求变成「必须留一个空格」的怪异 workaround。
 *
 * @param path       文件路径，必填
 * @param content    完整新内容，允许为空串，不允许为 null
 * @param baseSha256 编辑前的内容摘要，必填，用于并发冲突检测
 */
public record AgentConfigFileWriteRequest(
        @JsonProperty("path")
        @NotBlank(message = "path 不能为空")
        String path,

        @JsonProperty("content")
        @NotNull(message = "content 不能为 null（清空文件请传空串）")
        String content,

        @JsonProperty("base_sha256")
        @NotBlank(message = "base_sha256 不能为空（缺失将导致并发覆盖）")
        String baseSha256) {
}
