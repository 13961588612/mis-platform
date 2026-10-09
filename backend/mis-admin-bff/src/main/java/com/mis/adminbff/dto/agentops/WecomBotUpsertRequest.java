package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * 新建 / 编辑企微 Bot 入参（§4.3 #49/#50，对应前端 {@code types.ts:WecomBotPayload}）。
 *
 * <h2>{@code secret} 是「只写」字段，且<b>留空 ≠ 清空</b></h2>
 * 这是本 DTO 唯一需要小心的地方。编辑表单里 secret 输入框永远是空的
 * （因为读接口只回 {@code secret_masked}，拿不到真值）。若把「空」解释为
 * 「用户想把 secret 设成空」，那么任何一次只改名字的编辑操作都会把密钥清掉 ——
 * Bot 随即掉线，而操作者完全不知道自己做了什么。
 *
 * <p>所以语义固定为：<b>{@code secret} 为 null 或空白 = 不修改既有密钥</b>。
 * 新建时的必填性由 {@code WecomBotFacadeService#create} 显式校验，
 * 而不是在这里加 {@code @NotBlank} —— 加了会让编辑请求无法通过校验。
 * 「同一字段在新建与编辑下必填性不同」是注解式校验表达不了的，必须落到代码里。
 *
 * <h2>{@code botSecretId} 是下游的必填项，缺了必 422</h2>
 * 企微智能机器人长连接用官方 BotID 鉴权（{@code 59a3e32e} 把 {@code ws_url} 重命名而来），
 * 下游 {@code WecomBotCreateRequest} 声明为必填，BFF 漏字段会让 Python 直接回 422。
 * 前端表单新建/编辑均必填，故此处也加 {@code @NotBlank}。
 *
 * @param name         显示名，必填
 * @param botSecretId  企微官方 BotID（长连接鉴权），必填
 * @param secret       密钥；<b>留空表示不修改</b>，新建时由服务层校验必填
 * @param boundAgentId 绑定的 Agent，可空
 * @param corpId       企微企业 ID（身份绑定的 corp 维度），可空
 * @param tenantId     对应 MIS 租户 ID，可空
 */
public record WecomBotUpsertRequest(
        @JsonProperty("name")
        @NotBlank(message = "Bot 名称不能为空")
        @Size(max = 64, message = "Bot 名称长度不能超过 64")
        String name,

        @JsonProperty("bot_secret_id")
        @NotBlank(message = "企微 BotID 不能为空")
        @Size(max = 128, message = "企微 BotID 长度不能超过 128")
        String botSecretId,

        @JsonProperty("secret")
        @Size(max = 512, message = "secret 长度不能超过 512")
        String secret,

        @JsonProperty("bound_agent_id")
        @Size(max = 128, message = "bound_agent_id 长度不能超过 128")
        String boundAgentId,

        @JsonProperty("corp_id")
        @Size(max = 64, message = "corp_id 长度不能超过 64")
        String corpId,

        @JsonProperty("tenant_id")
        Integer tenantId) {

    /**
     * @return 用户是否在本次请求中提供了新密钥
     *
     * <p>调用方据此决定「把 secret 写进下游请求体」还是「整个字段都不带」。
     * 带一个空串下去和不带，在下游看来是两件事，不能混。
     */
    public boolean hasSecret() {
        return secret != null && !secret.isBlank();
    }
}
