package com.mis.adminbff.service.agentops;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.adminbff.client.AgentOpsClient;
import com.mis.adminbff.dto.agentops.WecomBotUpsertRequest;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 企微 Bot 门面（§4.3 #48–#54）。
 *
 * <h2>为什么独立成类而不是塞进 {@link AgentOpsFacadeService}</h2>
 * 这一组是唯一需要在 BFF 里做<b>字段级加工</b>的端点：secret 脱敏。
 * 把「读明文 → 脱敏 → 回显」的逻辑圈在这一个文件，等于把「密钥可能泄漏」的攻击面
 * 圈在十来行代码里，review 时一眼能看完，也不会被其它透传端点无意识地复用。
 *
 * <h2>secret 的两条铁律</h2>
 * <ol>
 *   <li><b>读接口永远不回明文</b>：下游（T04）返回的 Bot 含明文 secret，
 *       BFF 是这条链路上最后一个能拦住它的地方。脱敏动作收敛在此，
 *       而不是靠某个 VO「记得不序列化」—— 字段不存在 + 显式移除才是唯一不依赖记性的保证
 *       （见 {@code WecomBotVO} 类注释）。</li>
 *   <li><b>编辑时留空 ≠ 清空</b>：{@link WecomBotUpsertRequest#hasSecret()} 为 false 时，
 *       下游请求体<b>不带</b> secret 字段，让下游保留既有密钥。
 *       否则任何一次只改名字的编辑都会把 Bot 密钥清掉、随即掉线，而操作者毫无察觉
 *       （详见 DTO 注释）。</li>
 * </ol>
 */
@Service
public class WecomBotFacadeService {

    private static final Logger log = LoggerFactory.getLogger(WecomBotFacadeService.class);

    private final AgentOpsClient client;
    private final ObjectMapper objectMapper;

    public WecomBotFacadeService(AgentOpsClient client, ObjectMapper objectMapper) {
        this.client = client;
        this.objectMapper = objectMapper;
    }

    // ==================================================================
    // 企微 Bot §4.3 #48–#54
    // ==================================================================

    /** #48 列表：脱敏后返回。 */
    public JsonNode listBots() {
        return maskList(client.listWecomBots());
    }

    /**
     * #49 新建。
     *
     * <p>新建时 secret 必填（{@link WecomBotUpsertRequest} 因编辑场景不能加
     * {@code @NotBlank}，故在此显式校验）。下游建完回显，BFF 再脱敏一层。
     */
    public JsonNode createBot(WecomBotUpsertRequest request) {
        if (!request.hasSecret()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "新建企微 Bot 必须提供 secret");
        }
        return maskOne(client.createWecomBot(buildBody(request)));
    }

    /**
     * #50 编辑。
     *
     * <p>secret 留空表示不修改既有密钥：{@link #buildBody} 仅在
     * {@link WecomBotUpsertRequest#hasSecret()} 为真时才下发 secret 字段。
     */
    public JsonNode updateBot(String botId, WecomBotUpsertRequest request) {
        return maskOne(client.updateWecomBot(botId, buildBody(request)));
    }

    /** #51 删除（透传）。 */
    public JsonNode deleteBot(String botId) {
        return client.deleteWecomBot(botId);
    }

    /** #52 / #53 启停（透传）。 */
    public JsonNode toggleBot(String botId, String action) {
        return client.wecomBotToggle(botId, action);
    }

    /** #54 健康检查（透传，走 gateway 基址）。 */
    public JsonNode healthBots() {
        return client.wecomBotsHealth();
    }

    // ------------------------------------------------------------------
    // 内部：请求体组装 + 脱敏
    // ------------------------------------------------------------------

    /**
     * 组装下游请求体。
     *
     * <p>只在用户本次显式提供 secret 时才带该字段 —— 这是「留空=不修改」语义落地的唯一地方。
     * name / ws_url / bound_agent_id 始终下发（编辑场景下即便不变也无害，
     * 且下游用全量覆盖语义，缺了反而把其它字段抹掉）。
     */
    private Map<String, Object> buildBody(WecomBotUpsertRequest request) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", request.name());
        body.put("ws_url", request.wsUrl());
        body.put("bound_agent_id", request.boundAgentId());
        if (request.hasSecret()) {
            body.put("secret", request.secret());
        }
        return body;
    }

    /** 列表脱敏：兼容「单对象」与「数组」两种下游返回形态。 */
    private JsonNode maskList(JsonNode node) {
        if (node == null || node.isNull()) {
            return node;
        }
        if (node.isArray()) {
            ArrayNode arr = objectMapper.createArrayNode();
            node.forEach(item -> arr.add(maskOne(item)));
            return arr;
        }
        return maskOne(node);
    }

    /**
     * 单条脱敏。
     *
     * <p>无论下游回的是明文 {@code secret} 还是已脱敏的 {@code secret_masked}，
     * 结果里<b>只保留</b> {@code secret_masked}、绝不出现明文 {@code secret}。
     * 下游已给脱敏值时沿用（避免 BFF 二次脱敏把 {@code abc***xyz} 再脱成 {@code abc***}），
     * 否则按明文计算三段式掩码。
     */
    private JsonNode maskOne(JsonNode node) {
        if (node == null || !node.isObject()) {
            return node;
        }
        ObjectNode obj = (ObjectNode) node.deepCopy();
        JsonNode rawSecret = obj.remove("secret");
        JsonNode existingMask = obj.get("secret_masked");
        if (existingMask != null && !existingMask.isNull() && !existingMask.asText().isBlank()) {
            // 下游已脱敏，沿用，不二次加工
        } else if (rawSecret != null && rawSecret.isTextual() && !rawSecret.asText().isBlank()) {
            obj.put("secret_masked", mask(rawSecret.asText()));
        } else {
            obj.put("secret_masked", "");
        }
        return obj;
    }

    /**
     * 三段式掩码：保留首尾各 3 位，中间用 {@code ***} 代替。
     *
     * <p>长度 ≤ 6 时全遮，因为首尾加起来已占满或超出，露出任何一段都意义不大。
     */
    private static String mask(String secret) {
        int len = secret.length();
        if (len <= 6) {
            return "***";
        }
        return secret.substring(0, 3) + "***" + secret.substring(len - 3);
    }
}
