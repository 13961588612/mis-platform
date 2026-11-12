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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

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

    // ==================================================================
    // 企微用户身份绑定（wecom-user-binding-design.md §11）
    //
    // #59–#62 落在 ai-platform backend 的 /api/v1/channels/wecom/users**，
    // 与 Bot 域同源；bind/unbind/verify = agent:wecom:user:manage。
    // ==================================================================

    /** #59 绑定列表（agent:wecom:user:list）。 */
    @GetMapping("/users")
    public Result<JsonNode> listBindings(@RequestParam Map<String, String> query) {
        return Result.ok(wecomFacade.listWecomBindings(query));
    }

    /** #60 人工绑定（agent:wecom:user:manage）。 */
    @PostMapping("/users/{corpId}/{wecomUserId}/bind")
    public Result<JsonNode> bindUser(
            @PathVariable String corpId,
            @PathVariable String wecomUserId,
            @RequestBody(required = false) JsonNode body) {
        return Result.ok(wecomFacade.bindWecomUser(corpId, wecomUserId, body));
    }

    /** #61 解绑（置 disabled；agent:wecom:user:manage）。 */
    @PostMapping("/users/{corpId}/{wecomUserId}/unbind")
    public Result<JsonNode> unbindUser(
            @PathVariable String corpId, @PathVariable String wecomUserId) {
        return Result.ok(wecomFacade.unbindWecomUser(corpId, wecomUserId));
    }

    /** #62 校验（刷新 last_verified_at；agent:wecom:user:manage）。 */
    @PostMapping("/users/{corpId}/{wecomUserId}/verify")
    public Result<JsonNode> verifyUser(
            @PathVariable String corpId, @PathVariable String wecomUserId) {
        return Result.ok(wecomFacade.verifyWecomUser(corpId, wecomUserId));
    }

    /** #63 P5 同步回填（agent:wecom:user:manage）。 */
    @PostMapping("/users/sync-backfill")
    public Result<JsonNode> syncBackfill(@RequestParam Map<String, String> query) {
        return Result.ok(wecomFacade.syncBackfillWecomBindings(query));
    }

    // ==================================================================
    // 企微企业配置（方案 B：#64–#70，agent:wecom:manage）
    // ==================================================================

    /** #64 企业列表。 */
    @GetMapping("/corps")
    public Result<JsonNode> listCorps() {
        return Result.ok(wecomFacade.listWecomCorps());
    }

    /** #65 新增企业。 */
    @PostMapping("/corps")
    public Result<JsonNode> createCorp(@RequestBody(required = false) JsonNode body) {
        return Result.ok(wecomFacade.createWecomCorp(body));
    }

    /** #66 更新企业。 */
    @PutMapping("/corps/{corpId}")
    public Result<JsonNode> updateCorp(
            @PathVariable String corpId, @RequestBody(required = false) JsonNode body) {
        return Result.ok(wecomFacade.updateWecomCorp(corpId, body));
    }

    /** #67 删除企业（delete_secret=true 时一并清理密钥）。 */
    @DeleteMapping("/corps/{corpId}")
    public Result<JsonNode> deleteCorp(
            @PathVariable String corpId, @RequestParam Map<String, String> query) {
        return Result.ok(wecomFacade.deleteWecomCorp(corpId, query));
    }

    /** #68 写入 / 覆盖 corpsecret。 */
    @PutMapping("/corps/{corpId}/secret")
    public Result<JsonNode> setCorpSecret(
            @PathVariable String corpId, @RequestBody(required = false) JsonNode body) {
        return Result.ok(wecomFacade.setWecomCorpSecret(corpId, body));
    }

    /** #69 删除 corpsecret。 */
    @DeleteMapping("/corps/{corpId}/secret")
    public Result<JsonNode> deleteCorpSecret(@PathVariable String corpId) {
        return Result.ok(wecomFacade.deleteWecomCorpSecret(corpId));
    }

    /** #70 连通性测试。 */
    @PostMapping("/corps/{corpId}/test")
    public Result<JsonNode> testCorp(@PathVariable String corpId) {
        return Result.ok(wecomFacade.testWecomCorp(corpId));
    }
}
