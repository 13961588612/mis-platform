package com.mis.adminbff.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.mis.adminbff.dto.agentops.WecomBotUpsertRequest;
import com.mis.adminbff.service.agentops.WecomBotFacadeService;
import com.mis.common.core.result.Result;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 企微 Bot 域 BFF 端点（§4.3 #48–#54）。
 *
 * <h2>为什么单独成类</h2>
 * 这一组是唯一要做<b>字段级加工</b>（secret 脱敏）的端点，逻辑与权限码族
 * （{@code agent:wecom:list} / {@code agent:wecom:manage}）都自成一格，与透明透传的
 * {@link AgentOpsController} 以及授权域的 {@link AgentOpsGrantController} 分开，
 * 便于把「密钥可能泄漏」的攻击面圈在 {@link WecomBotFacadeService} 一处。
 *
 * <h2>路径与 V20 逐字对齐</h2>
 * 全部落在 {@code /api/v1/agent-ops/channels/wecom/bots...}，与注册表
 * （92147–92153）完全一致。其中 #54 的<b>真实下游</b>是 gateway（Node），但 BFF 暴露路径
 * 仍是同一前缀 —— 跨进程的差异被 {@link AgentOpsClient#wecomBotsHealth()} 吸收在 Client 内，
 * 不污染这里的路由。
 *
 * <h2>{@code /bots/health} 与 {@code /bots/{botId}} 不会抢</h2>
 * 本类只对 {@code /bots/{botId}} 注册了 POST（启停，正则 {@code enable|disable}），
 * <b>没有</b> GET 形式的 {@code /bots/{botId}}，故 {@code GET /bots/health} 只会命中
 * {@code healthBots()}。即便将来补 GET 详情，Spring 也优先匹配字面量段 {@code health}，
 * 不会误进变量段。
 *
 * <h2>判权走主路径</h2>
 * 权限码由注册表判定，不写 {@code @PreAuthorize}（双真值来源是大坑）。
 */
@RestController
@RequestMapping("/api/v1/agent-ops/channels/wecom")
public class AgentOpsChannelController {

    private final WecomBotFacadeService wecomFacade;

    public AgentOpsChannelController(WecomBotFacadeService wecomFacade) {
        this.wecomFacade = wecomFacade;
    }

    /** #48 企微 Bot 列表（脱敏后返回）。 */
    @GetMapping("/bots")
    public Result<JsonNode> listBots() {
        return Result.ok(wecomFacade.listBots());
    }

    /** #49 新增企微 Bot（secret 必填，脱敏回显）。 */
    @PostMapping("/bots")
    public Result<JsonNode> createBot(@Valid @RequestBody WecomBotUpsertRequest request) {
        return Result.ok(wecomFacade.createBot(request));
    }

    /** #50 编辑企微 Bot（secret 留空=不修改）。 */
    @PutMapping("/bots/{botId}")
    public Result<JsonNode> updateBot(
            @PathVariable String botId, @Valid @RequestBody WecomBotUpsertRequest request) {
        return Result.ok(wecomFacade.updateBot(botId, request));
    }

    /** #51 删除企微 Bot。 */
    @DeleteMapping("/bots/{botId}")
    public Result<JsonNode> deleteBot(@PathVariable String botId) {
        return Result.ok(wecomFacade.deleteBot(botId));
    }

    /** #52 / #53 启停企微 Bot（正则收口，禁止任意字符串拼路径）。 */
    @PostMapping("/bots/{botId}/{action:enable|disable}")
    public Result<JsonNode> toggleBot(@PathVariable String botId, @PathVariable String action) {
        return Result.ok(wecomFacade.toggleBot(botId, action));
    }

    /** #54 企微 Bot 健康（gateway）。 */
    @GetMapping("/bots/health")
    public Result<JsonNode> healthBots() {
        return Result.ok(wecomFacade.healthBots());
    }
}
