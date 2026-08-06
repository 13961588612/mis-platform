package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 配置文件内容（§4.3 #23，对应前端 {@code types.ts:ConfigFileContent}）。
 *
 * <h2>{@code masked} 是一道必需的护栏，不是提示信息</h2>
 * 服务端会把内容里的密钥替换成 {@code ***} 再返回。此时若允许整体保存，
 * 用户点一下「保存」就会把 {@code ***} 当作真值写回，<b>真密钥被永久覆盖</b>——
 * 而且这个操作看起来完全成功，没有任何报错，直到某个依赖该密钥的功能开始报鉴权失败，
 * 才有人反查到是当初那次保存。所以 {@code masked=true} 时前端必须禁用保存按钮
 * （impl-plan §4.4），后端也必须拒绝（T04）。两侧都做，因为任何一侧单独失效都是灾难。
 *
 * <h2>{@code sha256} 用于并发保护</h2>
 * 保存时以 {@code base_sha256} 回传；服务端比对不符则 409 CONFIG_CONFLICT。
 * 没有它，两个人同时编辑同一个文件时后保存者会静默覆盖前者 ——
 * 配置文件恰恰是最容易出现「两个人同时改」的对象。
 *
 * @param path     文件路径
 * @param content  文件内容（可能已脱敏）
 * @param format   {@code yaml} | {@code markdown}
 * @param editable 是否允许编辑
 * @param masked   内容是否含被替换成 {@code ***} 的密钥；为 true 时禁止整体保存
 * @param sha256   当前内容摘要，保存时作为 {@code base_sha256} 回传
 */
public record AgentConfigFileContentVO(
        @JsonProperty("path") String path,
        @JsonProperty("content") String content,
        @JsonProperty("format") String format,
        @JsonProperty("editable") Boolean editable,
        @JsonProperty("masked") Boolean masked,
        @JsonProperty("sha256") String sha256) {

    /**
     * @return 是否处于脱敏态；{@code null} 按 <b>true</b> 处理
     *
     * <p>取 true 而不是 false 作为兜底是刻意的：这个判断的失败代价严重不对称 ——
     * 误判为「已脱敏」只是多禁用一次保存按钮，用户刷新即可；
     * 误判为「未脱敏」则可能让 {@code ***} 覆盖真密钥。存疑时必须选保守的一侧。
     */
    public boolean maskedOrUnknown() {
        return masked == null || masked;
    }
}
