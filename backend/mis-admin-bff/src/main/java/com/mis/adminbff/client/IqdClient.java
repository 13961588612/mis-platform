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
import com.mis.adminbff.dto.iqd.IqdDimensionResolveVO;
import com.mis.adminbff.dto.iqd.IqdDimensionValueMapVO;
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
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;

import java.util.LinkedHashMap;
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
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<IqdDimensionValueMapVO>>> DIM_VALUE_MAP_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<IqdDimensionValueMapVO>> DIM_VALUE_MAP =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<IqdDimensionResolveVO>> DIM_RESOLVE =
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
    private final ObjectMapper objectMapper = new ObjectMapper();

    /**
     * 单次响应允许缓冲的最大字节数（16MB）。
     *
     * <p>WebClient 默认只给 256KB。问数审计列表 {@code GET /api/v1/iqd/traces?limit=100}
     * 的响应实测约 290KB（每条审计含 {@code sql_text} / {@code resolved_scope} /
     * {@code plan_steps} / {@code wren_status_trail} 等长 JSON 字符串），越过 256KB 后
     * 抛 {@code DataBufferLimitException}，被 {@code catch (Exception)} 兜住后表现为
     * 「下游调用失败: HTTP 200」——状态码明明是 200，看错误完全不知所云。
     * 问数审计详情、样本对 / 知识清单列表同理。
     *
     * <p>只放宽<b>本客户端</b>的编解码上限——见构造器里的 {@code clone()}。
     */
    private static final int MAX_IN_MEMORY_BYTES = 16 * 1024 * 1024;

    public IqdClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            IqdProperties properties) {
        super(buildClient(plainBuilder, properties), properties.getTimeoutMs());
        this.properties = properties;
    }

    /**
     * 组装本客户端专属的 {@link WebClient}。
     *
     * <p><b>{@code clone()} 是必需的</b>：{@code plainWebClientBuilder} 在
     * {@code BffConfiguration} 里是单例 Bean，而 {@code WebClient.Builder} 是可变对象。
     * {@code codecs()} 是<b>追加</b>语义（configurer 存进列表），直接调用会让此后所有共享
     * 该 builder 构建的下游客户端统统继承这里的 16MB 上限，且受影响范围随 Bean 创建顺序
     * 漂移。克隆出私有副本后，改动只作用于本客户端。
     */
    private static WebClient buildClient(WebClient.Builder plainBuilder, IqdProperties properties) {
        return plainBuilder.clone()
                .baseUrl(properties.getBaseUrl())
                .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(MAX_IN_MEMORY_BYTES))
                .build();
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
     * 删除单条范围策略。
     */
    public void deleteScopePolicy(Long id) {
        blockVoid(delete(loginContextHeaders(), "/api/v1/iqd/scope/policies/{id}", id));
    }

    public Map<String, Object> deleteScopePoliciesBatch(
            Long connectionId, String subjectType, String subjectId, List<String> itemKeys) {
        return block(client().post()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/scope/policies/delete-batch")
                        .queryParam("connectionId", connectionId)
                        .queryParam("subjectType", subjectType)
                        .queryParam("subjectId", subjectId)
                        .build())
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(itemKeys == null ? List.of() : itemKeys)
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
     * 按 id 更新知识/术语/口径（需 iqd:enhance:save；T04e 编辑能力）。
     */
    public IqdKnowledgeVO updateKnowledge(Long id, IqdKnowledgeSaveRequest dto) {
        return block(client().put()
                .uri("/api/v1/iqd/knowledge/{id}", id)
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

    // ------------------------------------------------------------------ 二期：语义模型编辑（P0-1~P0-12）

    /**
     * 编辑 catalog 节点（写回 MDL 前置）。
     *
     * <p>mis-iqd 侧可能返回业务冲突（40900 乐观并发 / 42200 引用阻断），其响应体为
     * {@code Result{code, message, data}}。WebClient 默认对 4xx 抛
     * {@link WebClientResponseException}，此处捕获并还原为 {@link BusinessException}
     * （保留原始 code 与 data），使 BFF 能把 {@code current_edit_revision} 等明细
     * 透传给前端，而非降级成 500。
     *
     * @param connectionId 问数连接 id（query 参数）
     * @param body         请求体 {item_key, kind, patch, base_revision, idempotency_key}
     * @return mis-iqd 返回 {edit_revision, edit_status, wren_ref_id}
     */
    public Map<String, Object> updateCatalogNode(Long connectionId, Map<String, Object> body) {
        // 防御：connectionId 为 null 时 WebClient 会拼出 `?connectionId=`（空值），
        // 下游把空串转成 null 后只报「系统错误」（50000），看不出是参数丢了 —— 这里直接拦。
        if (connectionId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "connectionId 不能为空");
        }
        try {
            Result<Map<String, Object>> res = client().put()
                    .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/catalog/node")
                            .queryParam("connectionId", connectionId)
                            .build())
                    .headers(loginContextHeaders())
                    .contentType(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(MAP_RESULT)
                    .block(timeout());
            return res != null ? res.getData() : null;
        } catch (WebClientResponseException ex) {
            throw extractDownstreamError(ex);
        } catch (BusinessException ex) {
            throw ex;
        } catch (Exception ex) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "下游调用失败: " + ex.getMessage());
        }
    }

    /**
     * 取连接级编辑同步状态（前端 CatalogSyncStatusBar 轮询）。
     */
    public Map<String, Object> getCatalogSyncStatus(Long connectionId) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/catalog/sync-status")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 触发对账（清空外部漂移标记，交由编排层按 model 范围重建）。
     */
    public Map<String, Object> reconcileCatalog(Long connectionId) {
        return block(client().post()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/catalog/reconcile")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 置外部漂移标记（S3：ai-platform 漂移检测命中回调）。
     */
    public Map<String, Object> setStaleDrift(Long connectionId, boolean drift) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("connection_id", connectionId);
        body.put("drift", drift);
        return block(client().post()
                .uri("/internal/v1/iqd/enhance/drift")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 列出全部问数连接（供定时对账清扫判定偏离连接；内部面 get-connections）。
     */
    public List<Map<String, Object>> getConnections() {
        return block(client().get()
                .uri("/internal/v1/iqd/get-connections")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST_RESULT));
    }

    /** 从 WebClient 4xx 响应体还原业务异常（保留 code 与 data）。 */
    private BusinessException extractDownstreamError(WebClientResponseException ex) {
        try {
            Map<String, Object> parsed = objectMapper.readValue(
                    ex.getResponseBodyAsString(), new TypeReference<Map<String, Object>>() {});
            Object codeObj = parsed.get("code");
            int code = codeObj instanceof Number
                    ? ((Number) codeObj).intValue() : ResultCode.INTERNAL_ERROR.getCode();
            String message = parsed.get("message") == null
                    ? ex.getMessage() : String.valueOf(parsed.get("message"));
            Object data = parsed.get("data");
            return new BusinessException(code, message, data);
        } catch (Exception ignore) {
            return new BusinessException(ResultCode.INTERNAL_ERROR,
                    "下游调用失败: HTTP " + ex.getStatusCode().value());
        }
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

    // ================================================================ 行级维度值映射（MIS 值 ⇄ 数仓值）

    /** 列出某连接的维度值映射（可按维度过滤）。 */
    public List<IqdDimensionValueMapVO> listDimensionValueMaps(Long connectionId, String dimensionCode) {
        return block(client().get()
                .uri(uriBuilder -> {
                    uriBuilder.path("/api/v1/iqd/dimension-value-maps")
                            .queryParam("connection_id", connectionId);
                    if (dimensionCode != null && !dimensionCode.isBlank()) {
                        uriBuilder.queryParam("dimension_code", dimensionCode);
                    }
                    return uriBuilder.build();
                })
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(DIM_VALUE_MAP_LIST));
    }

    /** 保存（幂等 upsert）一条维度值映射。 */
    public IqdDimensionValueMapVO saveDimensionValueMap(Map<String, Object> dto) {
        return block(client().post()
                .uri("/api/v1/iqd/dimension-value-maps")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(dto)
                .retrieve()
                .bodyToMono(DIM_VALUE_MAP));
    }

    /** 删除一条维度值映射。 */
    public void deleteDimensionValueMap(Long id) {
        blockVoid(delete(loginContextHeaders(), "/api/v1/iqd/dimension-value-maps/{id}", id));
    }

    /** 解析 MIS 值 → 数仓外部编码（映射维护页预览用）。 */
    public IqdDimensionResolveVO resolveDimensionValues(Map<String, Object> dto) {
        return block(client().post()
                .uri("/api/v1/iqd/dimension-value-maps/resolve")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(dto)
                .retrieve()
                .bodyToMono(DIM_RESOLVE));
    }

}
