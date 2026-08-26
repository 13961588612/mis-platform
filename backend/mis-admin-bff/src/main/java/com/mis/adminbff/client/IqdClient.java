package com.mis.adminbff.client;

import com.mis.adminbff.config.IqdProperties;
import com.mis.adminbff.dto.iqd.IqdAclSaveRequest;
import com.mis.adminbff.dto.iqd.IqdAclVO;
import com.mis.adminbff.dto.iqd.IqdAskLogVO;
import com.mis.adminbff.dto.iqd.IqdCatalogItemSaveRequest;
import com.mis.adminbff.dto.iqd.IqdCatalogItemVO;
import com.mis.adminbff.dto.iqd.IqdConnectionConfigVO;
import com.mis.adminbff.dto.iqd.IqdConnectionSaveRequest;
import com.mis.adminbff.dto.iqd.IqdConnectionTestVO;
import com.mis.adminbff.dto.iqd.IqdKnowledgeSaveRequest;
import com.mis.adminbff.dto.iqd.IqdKnowledgeVO;
import com.mis.adminbff.dto.iqd.IqdMaskRuleSaveRequest;
import com.mis.adminbff.dto.iqd.IqdMaskRuleVO;
import com.mis.adminbff.dto.iqd.IqdScopeDimensionVO;
import com.mis.adminbff.dto.iqd.IqdScopePolicySaveRequest;
import com.mis.adminbff.dto.iqd.IqdScopePolicyVO;
import com.mis.adminbff.dto.iqd.IqdSqlPairSaveRequest;
import com.mis.adminbff.dto.iqd.IqdSqlPairVO;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.List;
import java.util.Map;
import java.util.function.Consumer;

/**
 * 问数（IQD）mis-iqd 服务适配层客户端。
 *
 * <p>继承 {@link AbstractDownstreamClient}，复用其 WebClient 与身份头注入机制。
 * 转发两类端点：
 * <ul>
 *   <li>管理面 {@code /api/v1/iqd/**}：连接配置 CRUD + 连通自检（BFF → mis-iqd 管理面）</li>
 *   <li>内部面 {@code /internal/v1/iqd/**}：审计写入 + ACL/范围/维度/脱敏规则拉取（B3 骨架）</li>
 * </ul>
 *
 * <p>所有调用带 {@link #loginContextHeaders()}（透传 Gateway 上下文），
 * 供 mis-iqd 侧 DataScope / 操作人校验；与 mis-kb / mis-iam 客户端同口径。
 */
@Component
public class IqdClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<IqdConnectionConfigVO>> CONFIG_VO =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<Map<String, Object>>> MAP_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<Map<String, Object>>>> MAP_LIST_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<IqdConnectionTestVO>> TEST_VO =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<IqdCatalogItemVO>>> CATALOG_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<IqdScopePolicyVO>>> SCOPE_POLICY_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<IqdAclVO>>> ACL_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<IqdMaskRuleVO>>> MASK_RULE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<IqdScopeDimensionVO>>> DIMENSION_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<IqdMaskRuleVO>> MASK_RULE_VO =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<IqdScopeDimensionVO>> DIMENSION_VO =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<IqdAskLogVO>>> ASK_LOG_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<IqdAskLogVO>> ASK_LOG_VO =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<IqdSqlPairVO>>> SQL_PAIR_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<IqdSqlPairVO>> SQL_PAIR_VO =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<IqdKnowledgeVO>>> KNOWLEDGE_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<IqdKnowledgeVO>> KNOWLEDGE_VO =
            new ParameterizedTypeReference<>() {};

    private final IqdProperties properties;

    public IqdClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            IqdProperties properties) {
        super(plainBuilder.baseUrl(properties.getBaseUrl()).build(), properties.getTimeoutMs());
        this.properties = properties;
    }

    // ------------------------------------------------------------------ 管理面

    /**
     * 取连接配置（密钥恒回 ******）。
     */
    public IqdConnectionConfigVO getConfig() {
        return block(client().get()
                .uri("/api/v1/iqd/config")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(CONFIG_VO));
    }

    /**
     * 保存连接配置（upsert；密钥提交非空才更新）。
     *
     * @param dto 保存请求（snake_case wire）
     * @return 保存后的连接配置
     */
    public IqdConnectionConfigVO saveConfig(IqdConnectionSaveRequest dto) {
        return block(client().put()
                .uri("/api/v1/iqd/config")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(dto)
                .retrieve()
                .bodyToMono(CONFIG_VO));
    }

    /**
     * 连通性自检：mis-iqd 侧 GET {baseUrl}/health 探活并更新 status。
     *
     * @return 自检结果（status / latencyMs / message）
     */
    public IqdConnectionTestVO testConfig() {
        return block(client().post()
                .uri("/api/v1/iqd/config/test")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(TEST_VO));
    }

    // ------------------------------------------------------------------ 管理面（W2：清单/范围/ACL/脱敏/维度）

    /**
     * 查询清单项（左树 + 右栏）。
     */
    public List<IqdCatalogItemVO> listCatalog(Long connectionId) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/catalog")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(CATALOG_LIST));
    }

    /**
     * 批量 upsert 清单项。
     */
    public Map<String, Object> saveCatalogBatch(Long connectionId, List<IqdCatalogItemSaveRequest> items) {
        return block(client().post()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/catalog/batch")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(items)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 勾选「纳入问数范围」。
     */
    public Map<String, Object> setCatalogInScope(Long connectionId, boolean inScope, List<String> itemKeys) {
        return block(client().post()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/catalog/in-scope")
                        .queryParam("connectionId", connectionId)
                        .queryParam("inScope", inScope)
                        .build())
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(itemKeys)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 查询范围策略。
     */
    public List<IqdScopePolicyVO> listScopePolicies(Long connectionId) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/scope/policies")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(SCOPE_POLICY_LIST));
    }

    /**
     * 批量保存范围策略。
     */
    public Map<String, Object> saveScopePolicies(Long connectionId, List<IqdScopePolicySaveRequest> items) {
        return block(client().post()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/scope/policies")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(items)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 查询表级 ACL。
     */
    public List<IqdAclVO> listAcls(Long connectionId) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/acl")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ACL_LIST));
    }

    /**
     * 批量保存表级 ACL。
     */
    public Map<String, Object> saveAcls(Long connectionId, List<IqdAclSaveRequest> items) {
        return block(client().post()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/acl/batch")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(items)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 删除单条 ACL。
     */
    public void deleteAcl(Long id) {
        blockVoid(delete(loginContextHeaders(), "/api/v1/iqd/acl/{id}", id));
    }

    /**
     * 查询脱敏规则。
     */
    public List<IqdMaskRuleVO> listMaskRules() {
        return block(client().get()
                .uri("/api/v1/iqd/mask/rules")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MASK_RULE_LIST));
    }

    /**
     * 保存脱敏规则。
     */
    public IqdMaskRuleVO saveMaskRule(IqdMaskRuleSaveRequest dto) {
        return block(client().post()
                .uri("/api/v1/iqd/mask/rules")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(dto)
                .retrieve()
                .bodyToMono(MASK_RULE_VO));
    }

    /**
     * 删除脱敏规则。
     */
    public void deleteMaskRule(Long id) {
        blockVoid(delete(loginContextHeaders(), "/api/v1/iqd/mask/rules/{id}", id));
    }

    /**
     * 查询维度注册表。
     */
    public List<IqdScopeDimensionVO> listDimensions() {
        return block(client().get()
                .uri("/api/v1/iqd/dimensions")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(DIMENSION_LIST));
    }

    /**
     * 保存维度注册表条目。
     */
    public IqdScopeDimensionVO saveDimension(Map<String, Object> dto) {
        return block(client().post()
                .uri("/api/v1/iqd/dimensions")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(dto)
                .retrieve()
                .bodyToMono(DIMENSION_VO));
    }

    /**
     * 删除维度注册表条目。
     */
    public void deleteDimension(Long id) {
        blockVoid(delete(loginContextHeaders(), "/api/v1/iqd/dimensions/{id}", id));
    }

    /**
     * 触发单维度字典同步。
     */
    public Map<String, Object> syncDimension(String dimensionCode) {
        return block(client().post()
                .uri("/api/v1/iqd/scope/sync/{dimensionCode}", dimensionCode)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 拉取字典同步状态。
     */
    public List<Map<String, Object>> listDictSyncStatus() {
        return block(client().get()
                .uri("/api/v1/iqd/scope/dict-sync-status")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST_RESULT));
    }

    // ------------------------------------------------------------------ 管理面（W3：审计回查）

    /**
     * 分页回查问数审计日志（需 iqd:trace:view）。
     */
    public List<IqdAskLogVO> listTraces(Integer limit, String status, Long userId) {
        return block(client().get()
                .uri(uriBuilder -> {
                    var builder = uriBuilder.path("/api/v1/iqd/traces");
                    if (limit != null) {
                        builder.queryParam("limit", limit);
                    }
                    if (status != null && !status.isBlank()) {
                        builder.queryParam("status", status);
                    }
                    if (userId != null) {
                        builder.queryParam("userId", userId);
                    }
                    return builder.build();
                })
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ASK_LOG_LIST));
    }

    /**
     * 取单条审计日志详情（需 iqd:trace:view）。
     */
    public IqdAskLogVO getTrace(Long id) {
        return block(client().get()
                .uri("/api/v1/iqd/traces/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ASK_LOG_VO));
    }

    // ------------------------------------------------------------------ 管理面（W4：增强物料）

    /**
     * 查询连接下样本对（需 iqd:enhance:view）。
     */
    public List<IqdSqlPairVO> listSqlPairs(Long connectionId) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/sql-pairs")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(SQL_PAIR_LIST));
    }

    /**
     * 保存样本对（需 iqd:enhance:save）。
     */
    public IqdSqlPairVO saveSqlPair(IqdSqlPairSaveRequest dto) {
        return block(client().post()
                .uri("/api/v1/iqd/sql-pairs")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(dto)
                .retrieve()
                .bodyToMono(SQL_PAIR_VO));
    }

    /**
     * 删除样本对（需 iqd:enhance:save）。
     */
    public void deleteSqlPair(Long id) {
        blockVoid(delete(loginContextHeaders(), "/api/v1/iqd/sql-pairs/{id}", id));
    }

    /**
     * 查询连接下知识/术语/口径（需 iqd:enhance:view）。
     */
    public List<IqdKnowledgeVO> listKnowledge(Long connectionId, String kind) {
        return block(client().get()
                .uri(uriBuilder -> {
                    var builder = uriBuilder.path("/api/v1/iqd/knowledge")
                            .queryParam("connectionId", connectionId);
                    if (kind != null && !kind.isBlank()) {
                        builder.queryParam("kind", kind);
                    }
                    return builder.build();
                })
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(KNOWLEDGE_LIST));
    }

    /**
     * 保存知识/术语/口径（需 iqd:enhance:save）。
     */
    public IqdKnowledgeVO saveKnowledge(IqdKnowledgeSaveRequest dto) {
        return block(client().post()
                .uri("/api/v1/iqd/knowledge")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(dto)
                .retrieve()
                .bodyToMono(KNOWLEDGE_VO));
    }

    /**
     * 删除知识/术语/口径（需 iqd:enhance:save）。
     */
    public void deleteKnowledge(Long id) {
        blockVoid(delete(loginContextHeaders(), "/api/v1/iqd/knowledge/{id}", id));
    }

    /**
     * 从 S-07 单向拉入知识（需 iqd:enhance:save）。
     */
    public Map<String, Object> importS07Knowledge(Long connectionId) {
        return block(client().post()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/knowledge/import-s07")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 取待推送增强物料（需 iqd:enhance:sync）。
     */
    public Map<String, Object> pushEnhancements(Long connectionId) {
        return block(client().post()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/enhance/push")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 回查最近一次增强同步作业（需 iqd:enhance:view；P0-4 状态条）。
     *
     * @return mis-iqd 返回的作业数据（无作业则 data=null）
     */
    public Map<String, Object> getEnhancementSyncStatus(Long connectionId) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/enhance/sync-status")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    // ------------------------------------------------------------------ 内部面

    /**
     * 写问数审计日志（Worker 投影前全量调用；BFF 侧目前仅兜底透传，主路径由 Worker 直调）。
     *
     * @param payload 审计载荷（snake_case）
     * @return 落库后的日志行 id
     */
    public Long writeAskLog(Map<String, Object> payload) {
        Map<String, Object> body = block(client().post()
                .uri("/internal/v1/iqd/write-ask-log")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(MAP_RESULT));
        if (body == null || body.get("id") == null) {
            return null;
        }
        Object id = body.get("id");
        if (id instanceof Number number) {
            return number.longValue();
        }
        try {
            return Long.parseLong(String.valueOf(id));
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /**
     * 拉取表级 ACL（B3 扩展骨架；一期返回空数组）。
     */
    public List<Map<String, Object>> getAcls() {
        return block(client().get()
                .uri("/internal/v1/iqd/get-acls")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST_RESULT));
    }

    /**
     * 拉取范围策略（B3 扩展骨架；一期返回空数组）。
     */
    public List<Map<String, Object>> getScopePolicies() {
        return block(client().get()
                .uri("/internal/v1/iqd/get-scope-policies")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST_RESULT));
    }

    /**
     * 拉取行级范围维度注册表（B3 扩展骨架；一期返回空数组）。
     */
    public List<Map<String, Object>> getDimensions() {
        return block(client().get()
                .uri("/internal/v1/iqd/get-dimensions")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST_RESULT));
    }

    /**
     * 拉取脱敏规则（B3 扩展骨架；一期返回空数组）。
     */
    public List<Map<String, Object>> getMaskRules() {
        return block(client().get()
                .uri("/internal/v1/iqd/get-mask-rules")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST_RESULT));
    }

    /** 供 Facade 读取注入的配置属性（权限码 / agentId 等）。 */
    public IqdProperties properties() {
        return properties;
    }
}
