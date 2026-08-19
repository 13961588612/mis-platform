package com.mis.adminbff.client;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.config.BffProperties;
import com.mis.adminbff.dto.kb.KbAclVO;
import com.mis.adminbff.dto.kb.KbCategoryAdminVO;
import com.mis.adminbff.dto.kb.KbCategoryVO;
import com.mis.adminbff.dto.kb.KbDashboardVO;
import com.mis.adminbff.dto.kb.KbDocumentChunksVO;
import com.mis.adminbff.dto.kb.KbDocumentUploadResponse;
import com.mis.adminbff.dto.kb.KbDocumentVO;
import com.mis.adminbff.dto.kb.KbEngineCapabilitiesVO;
import com.mis.adminbff.dto.kb.KbEngineHealthVO;
import com.mis.adminbff.dto.kb.KbEngineModelPoolVO;
import com.mis.adminbff.dto.kb.KbEngineOrphanResolveRequest;
import com.mis.adminbff.dto.kb.KbEngineOrphanResolveResultVO;
import com.mis.adminbff.dto.kb.KbEngineOrphanVO;
import com.mis.adminbff.dto.kb.KbEngineRenameLogVO;
import com.mis.adminbff.dto.kb.KbEngineRenameReq;
import com.mis.adminbff.dto.kb.KbEngineRenameResultVO;
import com.mis.adminbff.dto.kb.KbEngineRenameRollbackRequest;
import com.mis.adminbff.dto.kb.KbEngineReconcileVO;
import com.mis.adminbff.dto.kb.KbEngineRefVO;
import com.mis.adminbff.dto.kb.KbHitTestRequest;
import com.mis.adminbff.dto.kb.KbHitTestResultVO;
import com.mis.adminbff.dto.kb.KbGraphBuildResultVO;
import com.mis.adminbff.dto.kb.KbGraphStatusVO;
import com.mis.adminbff.dto.kb.KbRaptorBuildResultVO;
import com.mis.adminbff.dto.kb.KbRaptorStatusVO;
import com.mis.adminbff.dto.kb.KbLibraryDeleteResultVO;
import com.mis.adminbff.dto.kb.KbLibraryDetailVO;
import com.mis.adminbff.dto.kb.KbLibraryVO;
import com.mis.adminbff.dto.kb.KbQaExportRow;
import com.mis.adminbff.dto.kb.KbQaFeedbackVO;
import com.mis.adminbff.dto.kb.KbQaSessionDetailVO;
import com.mis.adminbff.dto.kb.KbQaSessionListVO;
import com.mis.adminbff.dto.kb.KbQaSessionVO;
import com.mis.adminbff.dto.kb.KbQaTicketVO;
import com.mis.adminbff.dto.kb.KbRagSettings;
import com.mis.adminbff.dto.kb.KbReparseAllResultVO;
import com.mis.adminbff.dto.kb.KbSynonymConfigUpdateRequest;
import com.mis.adminbff.dto.kb.KbSynonymConfigVO;
import com.mis.adminbff.dto.kb.KbSynonymFileVO;
import com.mis.adminbff.dto.kb.KbSynonymGroupSaveRequest;
import com.mis.adminbff.dto.kb.KbSynonymGroupVO;
import com.mis.adminbff.dto.kb.KbSynonymImportCommitRequest;
import com.mis.adminbff.dto.kb.KbSynonymImportCommitVO;
import com.mis.adminbff.dto.kb.KbSynonymImportPrecheckVO;
import com.mis.adminbff.dto.kb.LegacyAclInventoryVO;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import org.springframework.web.util.UriBuilder;
import org.springframework.web.util.UriComponentsBuilder;
import reactor.core.publisher.Mono;

import java.net.URI;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * mis-kb 下游客户端。
 *
 * <p>统一走 {@code /internal/v1/kb/**}，透传登录上下文头（X-User-Id 等）供下游做可见性与归属校验。
 * 引擎原生 id 不会出现在任何返回体中。
 */
@Component
public class KbWebClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<List<KbCategoryVO>>> CATEGORY_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbCategoryVO>> CATEGORY =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbLibraryVO>>> LIBRARY_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbLibraryVO>> LIBRARY =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbDocumentVO>>> DOCUMENT_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbDocumentVO>> DOCUMENT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbDocumentChunksVO>> DOCUMENT_CHUNKS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbDocumentUploadResponse>> UPLOAD =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbReparseAllResultVO>> REPARSE_ALL =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbAclVO>>> ACL_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbAclVO>> ACL =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<LegacyAclInventoryVO>>> LEGACY_ACL_INVENTORY =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbQaSessionVO>>> QA_SESSION_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbQaSessionDetailVO>> QA_SESSION_DETAIL =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbQaFeedbackVO>> QA_FEEDBACK =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbQaFeedbackVO>>> QA_FEEDBACK_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbEngineHealthVO>> ENGINE_HEALTH =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbEngineCapabilitiesVO>> ENGINE_CAPS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbEngineModelPoolVO>> ENGINE_MODEL_POOL =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbLibraryDeleteResultVO>> LIBRARY_DELETE_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbEngineRefVO>> ENGINE_REF =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbEngineReconcileVO>> ENGINE_RECONCILE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbEngineOrphanVO>>> ENGINE_ORPHANS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbEngineOrphanResolveResultVO>> ENGINE_ORPHAN_RESOLVE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbEngineRenameResultVO>> ENGINE_RENAME_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbEngineRenameLogVO>>> ENGINE_RENAME_LOGS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<String>> STRING =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Void>> VOID =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbLibraryDetailVO>> LIBRARY_DETAIL =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbRagSettings>> RAG_SETTINGS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<KbQaSessionListVO>>> QA_SESSION_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbDashboardVO>> DASHBOARD =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbQaExportRow>>> EXPORT_ROWS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<PageResult<KbQaTicketVO>>> TICKET_PAGE =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbQaTicketVO>>> TICKET_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbQaTicketVO>> TICKET =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbHitTestResultVO>> HIT_TEST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbGraphBuildResultVO>> GRAPH_BUILD_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbGraphStatusVO>> GRAPH_STATUS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbRaptorBuildResultVO>> RAPTOR_BUILD_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbRaptorStatusVO>> RAPTOR_STATUS =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbCategoryAdminVO>>> CATEGORY_ADMIN_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbCategoryAdminVO>> CATEGORY_ADMIN =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<Set<Long>>> CATEGORY_ID_SET =
            new ParameterizedTypeReference<>() {};

    // ---------------------------------------------------------------- 同义词（Wave D / T10）

    /**
     * 同义词各端点<b>统一</b>的下游响应类型：{@code data} 一律先落成未定型的 {@link JsonNode}。
     *
     * <p><b>为什么不直接写成 {@code Result<KbSynonymGroupVO>}：</b>词条冲突（40927）时
     * mis-kb 往 {@code data} 里塞的是 {@code {term, ownerGroupId, ownerCanonicalTerm}}，
     * 与成功态的 {@code KbSynonymGroupVO} 形状完全不同。若按成功态类型解码，
     * Jackson 会把这三个「不认识」的字段悄悄丢掉（默认
     * {@code FAIL_ON_UNKNOWN_PROPERTIES=false}），得到一个字段全 {@code null} 的空壳——
     * 链路无异常、无日志，前端却只能显示一个没有意义的 {@code #-}，AC-11 当场判死。
     *
     * <p>先解成 {@code JsonNode}、成功后再按目标类型转换，成本是一次内存内的
     * {@code convertValue}，换来的是<b>错误明细的形状不受成功态类型约束</b>。
     */
    private static final ParameterizedTypeReference<Result<JsonNode>> SYNONYM_RAW =
            new ParameterizedTypeReference<>() {};

    private static final TypeReference<PageResult<KbSynonymGroupVO>> SYNONYM_GROUP_PAGE =
            new TypeReference<>() {};
    private static final TypeReference<KbSynonymGroupVO> SYNONYM_GROUP =
            new TypeReference<>() {};
    private static final TypeReference<KbSynonymConfigVO> SYNONYM_CONFIG =
            new TypeReference<>() {};
    private static final TypeReference<KbSynonymFileVO> SYNONYM_FILE =
            new TypeReference<>() {};
    private static final TypeReference<KbSynonymImportPrecheckVO> SYNONYM_PRECHECK =
            new TypeReference<>() {};
    private static final TypeReference<KbSynonymImportCommitVO> SYNONYM_COMMIT =
            new TypeReference<>() {};

    /**
     * 单次响应允许缓冲的最大字节数（16MB）。
     *
     * <p>WebClient 默认只给 256KB。同义词导出的硬上限是 10000 个术语组
     * （{@code SynonymImportService.EXPORT_MAX_GROUPS}），整份词表以 JSON 字符串形态
     * 装在 {@code Result<SynonymFileVO>.data.content} 里回传，5k～1 万词条的验收规模
     * 轻松越过 256KB —— 越过后抛的是 {@code DataBufferLimitException}，
     * 表现为「导出功能在小词表上一直好好的，词表一大就报下游调用失败」，
     * 排查成本极高。导入预检报告（最多 2000 行逐行明细）同理。
     *
     * <p>只放宽<b>本客户端</b>的编解码上限——见 {@link #buildClient} 里的 {@code clone()}，
     * 那一步是这句话能成立的前提。
     */
    private static final int MAX_IN_MEMORY_BYTES = 16 * 1024 * 1024;

    /**
     * 用于「{@link JsonNode} ↔ 目标 DTO」互转的映射器。
     *
     * <p>注入容器里那一个而不是 {@code new ObjectMapper()}：目标 DTO 含
     * {@code Instant}（{@code KbSynonymGroupVO.updatedAt} 等），裸实例没有注册
     * JavaTimeModule，转换会直接抛异常。用容器实例还能保证与 BFF 对外响应
     * 的日期格式口径完全一致。
     */
    private final ObjectMapper objectMapper;

    public KbWebClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            @Qualifier("loadBalancedWebClientBuilder") WebClient.Builder loadBalancedBuilder,
            BffProperties properties,
            ObjectMapper objectMapper) {
        super(buildClient(plainBuilder, loadBalancedBuilder, properties), properties.getAggregateTimeoutMs());
        this.objectMapper = objectMapper;
    }

    /**
     * 组装本客户端专属的 {@link WebClient}。
     *
     * <p><b>{@code clone()} 不是防御性写法，是必需的。</b>
     * {@code plainWebClientBuilder} / {@code loadBalancedWebClientBuilder} 在
     * {@code BffConfiguration} 里是<b>单例 Bean</b>，而 {@code WebClient.Builder} 是可变对象。
     * {@code baseUrl()} 每次调用是<b>覆盖</b>，各客户端各设各的、互不干扰；
     * 但 {@code codecs()} 是<b>追加</b>（{@code DefaultWebClientBuilder} 把 configurer 存进列表），
     * 直接调用会让此后<b>所有</b>用同一个 builder 构建的下游客户端
     * （AiPlatform / Iam / Org / System / Audit …）统统继承这里的 16MB 上限。
     * 更糟的是 Bean 创建顺序不保证，「谁受影响」会随启动顺序漂移——
     * 这种问题在测试里永远复现不出来。{@code clone()} 出一份私有副本后，
     * 改动只作用于本客户端；{@code @LoadBalanced} 注入的负载均衡过滤器
     * 会随副本一起带走，服务发现不受影响。
     *
     * @param plainBuilder        直连构建器
     * @param loadBalancedBuilder 服务发现构建器
     * @param properties          BFF 配置
     * @return 本客户端专属实例
     */
    private static WebClient buildClient(
            WebClient.Builder plainBuilder,
            WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        WebClient.Builder shared = properties.isKbDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        return shared.clone()
                .baseUrl(resolveBaseUrl(
                        properties.isKbDiscoveryEnabled(),
                        properties.getKbServiceId(),
                        properties.getKbBaseUrl()))
                .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(MAX_IN_MEMORY_BYTES))
                .build();
    }

    // ------------------------------------------------------------------ 分类

    public List<KbCategoryVO> listCategories() {
        List<KbCategoryVO> data = block(client().get()
                .uri("/internal/v1/kb/categories")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(CATEGORY_LIST));
        return data != null ? data : List.of();
    }

    public KbCategoryVO createCategory(Map<String, Object> body) {
        return block(client().post()
                .uri("/internal/v1/kb/categories")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(CATEGORY));
    }

    public KbCategoryVO updateCategory(Long id, Map<String, Object> body) {
        return block(client().put()
                .uri("/internal/v1/kb/categories/{id}", id)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(CATEGORY));
    }

    public void deleteCategory(Long id) {
        block(client().delete()
                .uri("/internal/v1/kb/categories/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID));
    }

    /** 管辖节点 id 列表（本人可管理的全部节点；知识库域一期）。 */
    public Set<Long> listManageableCategoryIds() {
        Set<Long> data = block(client().get()
                .uri("/internal/v1/kb/categories/manageable-ids")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(CATEGORY_ID_SET));
        return data != null ? data : Set.of();
    }

    /** 移动分类节点（知识库域一期；目标父节点须在管辖内且非自己后代）。 */
    public KbCategoryVO moveCategory(Long id, Long newParentId) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("newParentId", newParentId);
        return block(client().put()
                .uri("/internal/v1/kb/categories/{id}/move", id)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(CATEGORY));
    }

    // ------------------------------------------------------------------ 分类管理员（知识库域一期）

    /** 分类节点管理员列表。 */
    public List<KbCategoryAdminVO> listCategoryAdmins(Long categoryId) {
        List<KbCategoryAdminVO> data = block(client().get()
                .uri("/internal/v1/kb/categories/{id}/admins", categoryId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(CATEGORY_ADMIN_LIST));
        return data != null ? data : List.of();
    }

    /** 新增分类节点管理员。 */
    public KbCategoryAdminVO grantCategoryAdmin(Long categoryId, Map<String, Object> body) {
        return block(client().post()
                .uri("/internal/v1/kb/categories/{id}/admins", categoryId)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(CATEGORY_ADMIN));
    }

    /** 移除分类节点管理员。 */
    public void revokeCategoryAdmin(Long adminId) {
        block(client().delete()
                .uri("/internal/v1/kb/category-admins/{adminId}", adminId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID));
    }

    // ------------------------------------------------------------------ 知识库

    public List<KbLibraryVO> listLibraries(Long categoryId, String scope) {
        List<KbLibraryVO> data = block(client().get()
                .uri(queryUri("/internal/v1/kb/libraries", "categoryId", categoryId, "scope", scope))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(LIBRARY_LIST));
        return data != null ? data : List.of();
    }

    public KbLibraryVO getLibrary(Long id) {
        return block(client().get()
                .uri("/internal/v1/kb/libraries/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(LIBRARY));
    }

    public KbLibraryVO createLibrary(Map<String, Object> body) {
        return block(client().post()
                .uri("/internal/v1/kb/libraries")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(LIBRARY));
    }

    public KbLibraryVO updateLibrary(Long id, Map<String, Object> body) {
        return block(client().put()
                .uri("/internal/v1/kb/libraries/{id}", id)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(LIBRARY));
    }

    /**
     * 删除知识库（T04：透传 {@code mode} 与 {@code force}，返回回执）。
     *
     * <p>下游默认语义是<b>归档</b>而非物理删除，回执 {@code message} 已把这件事写清楚，
     * BFF 原样透传不做加工。
     *
     * <p><b>Q1 两段式确认流：</b>{@code force=false}（默认）时若下游检测到引擎侧 dataset
     * 已不存在，返回提示态回执（{@code engineMissing=true}，本地零变更），由前端警示并要求
     * 确认后以 {@code force=true} 重调——{@code force} 只对 engineMissing 生效，
     * 不豁免其它失败语义（mis-kb 侧严格限定）。
     *
     * @param id    知识库 id
     * @param mode  {@code archive} / {@code physical}
     * @param force 是否跳过引擎直接本地执行（仅对 engineMissing 生效，默认 false）
     * @return 删除回执
     */
    public KbLibraryDeleteResultVO deleteLibrary(Long id, String mode, boolean force) {
        return block(client().method(org.springframework.http.HttpMethod.DELETE)
                .uri(uriBuilder -> uriBuilder
                        .path("/internal/v1/kb/libraries/{id}")
                        .queryParam("mode", mode)
                        .queryParam("force", force)
                        .build(id))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(LIBRARY_DELETE_RESULT));
    }

    /**
     * 查看知识库的引擎引用（Q4，含 dataset_id）。
     *
     * @param id 知识库 id
     * @return 引擎引用视图
     */
    public KbEngineRefVO getEngineRef(Long id) {
        return block(client().get()
                .uri("/internal/v1/kb/libraries/{id}/engine-ref", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ENGINE_REF));
    }

    /** 知识库详情聚合（L-06）。 */
    public KbLibraryDetailVO getLibraryDetail(Long id) {
        return block(client().get()
                .uri("/internal/v1/kb/libraries/{id}/detail", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(LIBRARY_DETAIL));
    }

    /** 读取知识库 RAG 设置（L-08）。 */
    public KbRagSettings getRagSettings(Long libraryId) {
        return block(client().get()
                .uri("/internal/v1/kb/libraries/{id}/engine/settings", libraryId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(RAG_SETTINGS));
    }

    /** 保存知识库 RAG 设置（L-08）。 */
    public KbRagSettings updateRagSettings(Long libraryId, KbRagSettings settings) {
        return block(client().put()
                .uri("/internal/v1/kb/libraries/{id}/engine/settings", libraryId)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(settings)
                .retrieve()
                .bodyToMono(RAG_SETTINGS));
    }

    /** 触发图谱构建（Wave B GraphRAG PoC，T02）。 */
    public KbGraphBuildResultVO buildGraph(Long libraryId) {
        return block(client().post()
                .uri("/internal/v1/kb/libraries/{id}/graph/build", libraryId)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of())
                .retrieve()
                .bodyToMono(GRAPH_BUILD_RESULT));
    }

    /** 查询图谱构建状态（Wave B GraphRAG PoC，T02；前端 3s 轮询）。 */
    public KbGraphStatusVO graphBuildStatus(Long libraryId) {
        return block(client().get()
                .uri("/internal/v1/kb/libraries/{id}/graph/build-status", libraryId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(GRAPH_STATUS));
    }

    /**
     * 触发 RAPTOR 摘要构建（Wave C RAPTOR，T02）。
     *
     * <p>POST /internal/v1/kb/libraries/{id}/raptor/build（mis-kb 内部端点），
     * BFF 只透传不做任何业务决策。
     */
    public KbRaptorBuildResultVO buildRaptor(Long libraryId) {
        return block(client().post()
                .uri("/internal/v1/kb/libraries/{id}/raptor/build", libraryId)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(Map.of())
                .retrieve()
                .bodyToMono(RAPTOR_BUILD_RESULT));
    }

    /** 查询 RAPTOR 构建状态（Wave C RAPTOR，T02；前端 3s 轮询）。 */
    public KbRaptorStatusVO raptorBuildStatus(Long libraryId) {
        return block(client().get()
                .uri("/internal/v1/kb/libraries/{id}/raptor/build-status", libraryId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(RAPTOR_STATUS));
    }

    // ------------------------------------------------------------------ 文档

    public List<KbDocumentVO> listDocuments(Long libraryId) {
        List<KbDocumentVO> data = block(client().get()
                .uri("/internal/v1/kb/libraries/{libraryId}/documents", libraryId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(DOCUMENT_LIST));
        return data != null ? data : List.of();
    }

    public KbDocumentVO getDocument(Long libraryId, Long id) {
        return block(client().get()
                .uri("/internal/v1/kb/libraries/{libraryId}/documents/{id}", libraryId, id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(DOCUMENT));
    }

    /**
     * 分页列举文档切片（「查看文档切分效果」；三层透传，不做业务决策）。
     *
     * <p>keywords 为空时不携带该查询参数（mis-kb 侧 null 处理）；pageSize 默认 50。
     */
    public KbDocumentChunksVO listDocumentChunks(
            Long libraryId, Long id, String keywords, int page, int pageSize) {
        String uri = UriComponentsBuilder
                .fromPath("/internal/v1/kb/libraries/{libraryId}/documents/{id}/chunks")
                .queryParam("page", Math.max(page, 1))
                .queryParam("pageSize", Math.max(pageSize, 1))
                .queryParamIfPresent("keywords",
                        keywords == null || keywords.isBlank()
                                ? java.util.Optional.empty()
                                : java.util.Optional.of(keywords))
                .buildAndExpand(libraryId, id)
                .toUriString();
        return block(client().get()
                .uri(uri)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(DOCUMENT_CHUNKS));
    }

    /**
     * 拉取分片版面截图（直吐 JPEG 字节；三层透传）。
     */
    public byte[] getChunkImage(Long libraryId, Long id, String imageId) {
        return blockBytes(client().get()
                .uri("/internal/v1/kb/libraries/{libraryId}/documents/{id}/chunk-images/{imageId}",
                        libraryId, id, imageId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(byte[].class));
    }

    /** 透传 multipart 上传（保留原始文件名与内容类型；可选文件级切片参数）。 */
    public KbDocumentUploadResponse uploadDocument(
            Long libraryId, String filename, String contentType, byte[] bytes,
            String chunkMethod, Integer chunkTokenNum, String separator,
            Boolean pageIndex, Integer imageTableContextWindow,
            Integer autoKeywords, Integer autoQuestions) {
        MultipartBodyBuilder builder = new MultipartBodyBuilder();
        ByteArrayResource resource = new ByteArrayResource(bytes) {
            @Override
            public String getFilename() {
                return filename;
            }
        };
        builder.part("file", resource)
                .filename(filename)
                .contentType(contentType != null
                        ? MediaType.parseMediaType(contentType)
                        : MediaType.APPLICATION_OCTET_STREAM);
        if (chunkMethod != null && !chunkMethod.isBlank()) {
            builder.part("chunkMethod", chunkMethod);
        }
        if (chunkTokenNum != null) {
            builder.part("chunkTokenNum", String.valueOf(chunkTokenNum));
        }
        if (separator != null) {
            builder.part("separator", separator);
        }
        if (pageIndex != null) {
            builder.part("pageIndex", String.valueOf(pageIndex));
        }
        if (imageTableContextWindow != null) {
            builder.part("imageTableContextWindow", String.valueOf(imageTableContextWindow));
        }
        if (autoKeywords != null) {
            builder.part("autoKeywords", String.valueOf(autoKeywords));
        }
        if (autoQuestions != null) {
            builder.part("autoQuestions", String.valueOf(autoQuestions));
        }
        return block(client().post()
                .uri("/internal/v1/kb/libraries/{libraryId}/documents", libraryId)
                .headers(loginContextHeaders())
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(BodyInserters.fromMultipartData(builder.build()))
                .retrieve()
                .bodyToMono(UPLOAD));
    }

    public void setDocumentEnabled(Long libraryId, Long id, boolean enabled) {
        String uri = UriComponentsBuilder
                .fromPath("/internal/v1/kb/libraries/{libraryId}/documents/{id}/enable")
                .queryParam("enabled", enabled)
                .buildAndExpand(libraryId, id)
                .toUriString();
        block(client().put()
                .uri(uri)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID));
    }

    public void reparseDocument(Long libraryId, Long id) {
        block(client().post()
                .uri("/internal/v1/kb/libraries/{libraryId}/documents/{id}/reparse", libraryId, id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID));
    }

    /**
     * 库级一键全部重解析（P1-1：换嵌入模型后全量重解析恢复检索；KE-05 扩展 onlyFailed）。
     *
     * @param libraryId  知识库 id
     * @param onlyFailed 仅重试 {@code parse_status=failed} 文档；{@code false} = 全量
     * @return 批量结果
     */
    public KbReparseAllResultVO reparseAllDocuments(Long libraryId, boolean onlyFailed) {
        String uri = UriComponentsBuilder
                .fromPath("/internal/v1/kb/libraries/{libraryId}/documents/reparse-all")
                .queryParam("onlyFailed", onlyFailed)
                .buildAndExpand(libraryId)
                .toUriString();
        return block(client().post()
                .uri(uri)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(REPARSE_ALL));
    }

    /** 更新文档级切片配置（kb_settings_model_chunk；改参触发重解析）。 */
    public void updateDocumentChunkConfig(
            Long libraryId, Long docId, Map<String, Object> body) {
        block(client().put()
                .uri("/internal/v1/kb/libraries/{libraryId}/documents/{docId}/chunk-config",
                        libraryId, docId)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(VOID));
    }

    public void deleteDocument(Long libraryId, Long id) {
        block(client().delete()
                .uri("/internal/v1/kb/libraries/{libraryId}/documents/{id}", libraryId, id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID));
    }

    // ------------------------------------------------------------------ ACL

    public List<KbAclVO> listAcls(Long libraryId) {
        List<KbAclVO> data = block(client().get()
                .uri("/internal/v1/kb/libraries/{libraryId}/acls", libraryId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ACL_LIST));
        return data != null ? data : List.of();
    }

    public KbAclVO grantAcl(Long libraryId, Map<String, Object> body) {
        return block(client().post()
                .uri("/internal/v1/kb/libraries/{libraryId}/acls", libraryId)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(ACL));
    }

    public void revokeAcl(Long aclId) {
        block(client().delete()
                .uri("/internal/v1/kb/libraries/acls/{id}", aclId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID));
    }

    /**
     * KBP-10 存量 manage/acl 授权清单（只读，运营清理依据）。
     *
     * <p>实际路径 {@code GET /internal/v1/kb/libraries/acls/inventory}（mis-kb 控制器类级
     * 前缀 {@code /internal/v1/kb/libraries} + 方法级 {@code /acls/inventory}）；
     * mis-kb 侧前置 {@code isGlobalAdmin}（非全局管理员 40311），BFF 另有
     * {@code kb:acl:revoke} 权限码兜底（双闸门）。
     *
     * @param libraryId   按库维度过滤；{@code null} = 不限制
     * @param subjectType 按主体类型过滤；{@code null} = 不限制
     * @param subjectId   按主体 id 过滤；{@code null} = 不限制
     * @return 存量授权清单（mis-kb 侧 subjectName 恒为 null，由门面回填）
     */
    public List<LegacyAclInventoryVO> listLegacyAclInventory(
            Long libraryId, String subjectType, Long subjectId) {
        List<LegacyAclInventoryVO> data = block(client().get()
                .uri(queryUri("/internal/v1/kb/libraries/acls/inventory",
                        "libraryId", libraryId, "subjectType", subjectType, "subjectId", subjectId))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(LEGACY_ACL_INVENTORY));
        return data != null ? data : List.of();
    }

    // ------------------------------------------------------------------ 问答历史 / 反馈

    public List<KbQaSessionVO> listMySessions() {
        List<KbQaSessionVO> data = block(client().get()
                .uri("/internal/v1/kb/qa/sessions/mine")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(QA_SESSION_LIST));
        return data != null ? data : List.of();
    }

    public KbQaSessionDetailVO getSessionDetail(Long sessionId) {
        return block(client().get()
                .uri("/internal/v1/kb/qa/sessions/{sessionId}", sessionId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(QA_SESSION_DETAIL));
    }

    /** 删除问答会话（用户侧软删除；mis-kb 侧幂等）。 */
    public void deleteSession(Long sessionId) {
        block(client().delete()
                .uri("/internal/v1/kb/qa/sessions/{sessionId}", sessionId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID));
    }

    public KbQaFeedbackVO submitFeedback(Map<String, Object> body) {
        return block(client().post()
                .uri("/internal/v1/kb/qa/feedback")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(QA_FEEDBACK));
    }

    public KbQaFeedbackVO getFeedback(Long sessionId) {
        return block(client().get()
                .uri("/internal/v1/kb/qa/sessions/{sessionId}/feedback", sessionId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(QA_FEEDBACK));
    }

    // ------------------------------------------------------------------ 运营（只读）

    /**
     * P0 全量会话列表。
     *
     * <p>下游路径已从 {@code /operations/qa/sessions} 平移到 {@code /operations/qa/sessions-all}
     * ——原路径被 A-02b 的分页版占用。此方法仅供 P0 老页面兜底，新页面走
     * {@link #listOperationSessions}。
     */
    public List<KbQaSessionVO> listAllSessions() {
        List<KbQaSessionVO> data = block(client().get()
                .uri("/internal/v1/kb/operations/qa/sessions-all")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(QA_SESSION_LIST));
        return data != null ? data : List.of();
    }

    public List<KbQaFeedbackVO> listAllFeedback() {
        List<KbQaFeedbackVO> data = block(client().get()
                .uri("/internal/v1/kb/operations/qa/feedback")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(QA_FEEDBACK_LIST));
        return data != null ? data : List.of();
    }

    /** 运营问答列表（A-02b，带筛选分页）。 */
    public PageResult<KbQaSessionListVO> listOperationSessions(Map<String, Object> params) {
        return block(client().get()
                .uri(buildUri("/internal/v1/kb/operations/qa/sessions", params))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(QA_SESSION_PAGE));
    }

    /** 运营问答详情（A-02a，含可见范围与召回参数）。 */
    public KbQaSessionDetailVO getOperationSessionDetail(Long sessionId) {
        return block(client().get()
                .uri("/internal/v1/kb/operations/qa/sessions/{id}", sessionId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(QA_SESSION_DETAIL));
    }

    /** 评价看板统计（A-02b/d）。 */
    public KbDashboardVO stats(Map<String, Object> params) {
        return block(client().get()
                .uri(buildUri("/internal/v1/kb/operations/stats", params))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(DASHBOARD));
    }

    /** 导出行数据（A-02e）。 */
    public List<KbQaExportRow> exportRows(Map<String, Object> params) {
        List<KbQaExportRow> data = block(client().get()
                .uri(buildUri("/internal/v1/kb/operations/qa/export", params))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(EXPORT_ROWS));
        return data != null ? data : List.of();
    }

    // ------------------------------------------------------------------ 工单（F-10 / A-02c）

    /** 建工单。 */
    public KbQaTicketVO createTicket(Map<String, Object> body) {
        return block(client().post()
                .uri("/internal/v1/kb/operations/qa/tickets")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(TICKET));
    }

    /** 工单分页列表。 */
    public PageResult<KbQaTicketVO> listTickets(Map<String, Object> params) {
        return block(client().get()
                .uri(buildUri("/internal/v1/kb/operations/qa/tickets", params))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(TICKET_PAGE));
    }

    /** 工单详情。 */
    public KbQaTicketVO getTicket(Long ticketId) {
        return block(client().get()
                .uri("/internal/v1/kb/operations/qa/tickets/{id}", ticketId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(TICKET));
    }

    /** 处理/关闭工单。 */
    public KbQaTicketVO patchTicket(Long ticketId, Map<String, Object> body) {
        return block(client().patch()
                .uri("/internal/v1/kb/operations/qa/tickets/{id}", ticketId)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(TICKET));
    }

    /**
     * 标记问答反馈已处理/忽略（OP-05）。
     *
     * <p>处理人身份经 {@code loginContextHeaders()} 透传，mis-kb 侧以登录上下文头为准
     * （不信任请求体身份）；状态机 pending → handled/ignored 单向终态由 mis-kb 裁定。
     *
     * @param feedbackId 反馈 id
     * @param body       {@code {status, note}}；status 必填，note 可空
     * @return 更新后的反馈视图（含处理状态五字段）
     */
    public KbQaFeedbackVO processFeedback(Long feedbackId, Map<String, Object> body) {
        return block(client().patch()
                .uri("/internal/v1/kb/operations/qa/feedback/{id}/process", feedbackId)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(QA_FEEDBACK));
    }

    /** 某会话下的工单列表。 */
    public List<KbQaTicketVO> listTicketsBySession(Long sessionId) {
        List<KbQaTicketVO> data = block(client().get()
                .uri("/internal/v1/kb/operations/qa/tickets/by-session/{id}", sessionId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(TICKET_LIST));
        return data != null ? data : List.of();
    }

    // ------------------------------------------------------------------ 命中测试（Q-04 / WA-07）

    /**
     * 调用 mis-kb 命中测试端点。
     *
     * <p>身份走 {@code loginContextHeaders()} 的 {@code X-User-Id} 透传头，
     * 请求体里<b>不带</b> userId——mis-kb 侧也明确不信任请求体身份。
     *
     * @param request 命中测试请求
     * @return 命中结果
     */
    public KbHitTestResultVO hitTest(KbHitTestRequest request) {
        return block(client().post()
                .uri("/internal/v1/kb/hit-test")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(HIT_TEST));
    }

    // ------------------------------------------------------------------ 引擎（S-04）

    public KbEngineHealthVO engineHealth() {
        return block(client().get()
                .uri("/internal/v1/kb/engine/health")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ENGINE_HEALTH));
    }

    public KbEngineCapabilitiesVO engineCapabilities() {
        return block(client().get()
                .uri("/internal/v1/kb/engine/capabilities")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ENGINE_CAPS));
    }

    /** 模型池（embedding[]/rerank[]/available/degradedReason/globalRerankModelId）。 */
    public KbEngineModelPoolVO listEngineModels() {
        return block(client().get()
                .uri("/internal/v1/kb/engine/models")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ENGINE_MODEL_POOL));
    }

    public String engineType() {
        return block(client().get()
                .uri("/internal/v1/kb/engine/type")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(STRING));
    }

    /**
     * 读取最近一次引擎对账报告（T04）。
     *
     * <p>只读缓存，不触发引擎调用。
     *
     * @return 对账报告
     */
    public KbEngineReconcileVO engineReconcileReport() {
        return block(client().get()
                .uri("/internal/v1/kb/engine/reconcile")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ENGINE_RECONCILE));
    }

    /**
     * 手动触发一次引擎对账（T04）。
     *
     * @return 本次对账报告
     */
    public KbEngineReconcileVO runEngineReconcile() {
        return block(client().post()
                .uri("/internal/v1/kb/engine/reconcile")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ENGINE_RECONCILE));
    }

    /**
     * 列出引擎侧游离 dataset（P1-T3）。
     *
     * @param engineType 引擎类型；{@code null} 取当前引擎
     * @param resolved    0=待处理 1=已处置
     * @return 游离项视图列表
     */
    public List<KbEngineOrphanVO> listEngineOrphans(String engineType, int resolved) {
        StringBuilder uri = new StringBuilder("/internal/v1/kb/engine/orphans?resolved=").append(resolved);
        if (engineType != null && !engineType.isBlank()) {
            uri.append("&engineType=").append(engineType);
        }
        return block(client().get()
                .uri(uri.toString())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ENGINE_ORPHANS));
    }

    /**
     * 处置一个游离 dataset（P1-T3）。
     *
     * @param engineType 引擎类型；{@code null} 取当前引擎
     * @param nativeId   引擎原生 dataset id
     * @param req        处置请求
     * @return 处置结果
     */
    public KbEngineOrphanResolveResultVO resolveEngineOrphan(
            String engineType, String nativeId, KbEngineOrphanResolveRequest req) {
        StringBuilder uri = new StringBuilder("/internal/v1/kb/engine/orphans/")
                .append(nativeId).append("/resolve");
        if (engineType != null && !engineType.isBlank()) {
            uri.append("?engineType=").append(engineType);
        }
        return block(client().post()
                .uri(uri.toString())
                .headers(loginContextHeaders())
                .bodyValue(req)
                .retrieve()
                .bodyToMono(ENGINE_ORPHAN_RESOLVE));
    }

    /**
     * 存量 dataset 批量重命名（P1-T4，dry-run 或执行）。
     *
     * @param req 请求（dryRun / confirmToken / limit）
     * @return 本次结果（含 batchId）
     */
    public KbEngineRenameResultVO renameDatasets(KbEngineRenameReq req) {
        return block(client().post()
                .uri("/internal/v1/kb/engine/datasets/rename")
                .headers(loginContextHeaders())
                .bodyValue(req)
                .retrieve()
                .bodyToMono(ENGINE_RENAME_RESULT));
    }

    /**
     * 回滚某批次的重命名（P1-T4）。
     *
     * @param batchId 原执行批次号
     * @return 回滚结果
     */
    public KbEngineRenameResultVO rollbackRenameDatasets(String batchId) {
        return block(client().post()
                .uri("/internal/v1/kb/engine/datasets/rename/rollback")
                .headers(loginContextHeaders())
                .bodyValue(new KbEngineRenameRollbackRequest(batchId))
                .retrieve()
                .bodyToMono(ENGINE_RENAME_RESULT));
    }

    /**
     * 最近的重命名日志（P1-T4）。
     *
     * @param limit 返回条数
     * @return 日志视图列表
     */
    public List<KbEngineRenameLogVO> listRenameLogs(int limit) {
        return block(client().get()
                .uri("/internal/v1/kb/engine/datasets/rename/logs?limit=" + limit)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ENGINE_RENAME_LOGS));
    }

    /**
     * 某批次的重命名日志（P1-T4）。
     *
     * @param batchId 批次号
     * @return 该批次日志视图列表
     */
    public List<KbEngineRenameLogVO> getRenameLogsByBatch(String batchId) {
        return block(client().get()
                .uri("/internal/v1/kb/engine/datasets/rename/logs/" + batchId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(ENGINE_RENAME_LOGS));
    }

    // ------------------------------------------------------------------ 同义词（S-07 / Wave D）

    /**
     * 术语组分页列表。
     *
     * @param params {@code keyword} / {@code status} / {@code page} / {@code size} / {@code sort}
     * @return 分页结果
     */
    public PageResult<KbSynonymGroupVO> listSynonymGroups(Map<String, Object> params) {
        return blockSynonym(client().get()
                .uri(buildUri("/internal/v1/kb/synonyms", params))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_GROUP_PAGE);
    }

    /**
     * 术语组详情（含完整词条列表）。
     *
     * @param id 组 ID
     * @return 详情视图
     */
    public KbSynonymGroupVO getSynonymGroup(Long id) {
        return blockSynonym(client().get()
                .uri("/internal/v1/kb/synonyms/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_GROUP);
    }

    /**
     * 新建术语组。
     *
     * <p>词条冲突时下游返回 40927，明细经 {@link #blockSynonym} 原样上抛。
     *
     * @param request 保存请求
     * @return 新建后的详情
     */
    public KbSynonymGroupVO createSynonymGroup(KbSynonymGroupSaveRequest request) {
        return blockSynonym(client().post()
                .uri("/internal/v1/kb/synonyms")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_GROUP);
    }

    /**
     * 编辑术语组。冲突语义同 {@link #createSynonymGroup}。
     *
     * @param id      组 ID
     * @param request 保存请求
     * @return 保存后的详情
     */
    public KbSynonymGroupVO updateSynonymGroup(Long id, KbSynonymGroupSaveRequest request) {
        return blockSynonym(client().put()
                .uri("/internal/v1/kb/synonyms/{id}", id)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_GROUP);
    }

    /**
     * 删除术语组（硬删，级联删词条）。
     *
     * @param id 组 ID
     */
    public void deleteSynonymGroup(Long id) {
        discardSynonym(client().delete()
                .uri("/internal/v1/kb/synonyms/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(SYNONYM_RAW));
    }

    /**
     * 读取同义词全局配置（双闸 + 预算 + 规模水位）。
     *
     * @return 配置视图
     */
    public KbSynonymConfigVO getSynonymConfig() {
        return blockSynonym(client().get()
                .uri("/internal/v1/kb/synonyms/config")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_CONFIG);
    }

    /**
     * 切换库内业务开关。
     *
     * @param request 开关请求
     * @return 切换后的配置视图
     */
    public KbSynonymConfigVO updateSynonymConfig(KbSynonymConfigUpdateRequest request) {
        return blockSynonym(client().put()
                .uri("/internal/v1/kb/synonyms/config")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_CONFIG);
    }

    /**
     * 导出词表。
     *
     * <p>内部这一跳走 JSON（{@code Result<SynonymFileVO>}）而非字节流，
     * 导出超限（40926）才能沿统一错误通道把 code/message 带回来。
     *
     * @param params {@code keyword} / {@code status} / {@code format}
     * @return 文件载荷（文本内容，CSV 场景已含 BOM）
     */
    public KbSynonymFileVO exportSynonyms(Map<String, Object> params) {
        return blockSynonym(client().get()
                .uri(buildUri("/internal/v1/kb/synonyms/export", params))
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_FILE);
    }

    /**
     * 导入阶段一 · 预检：<b>原样透传 multipart</b>。
     *
     * <p>照 {@link #uploadDocument} 同款写法。<b>BFF 不解析文件内容</b>——
     * CSV/JSON 的表头校验、别名切分、BOM 容忍全部是领域语义，收口在 mis-kb。
     * 在这里「顺手」解析一次，等于让同一套格式规则有两份实现，
     * 将来改分隔符只改一边就是线上事故。
     *
     * @param filename    原始文件名（下游按扩展名嗅探格式，必须原样带上）
     * @param contentType 原始内容类型；{@code null} 时回落 octet-stream
     * @param bytes       文件字节
     * @return 预检报告
     */
    public KbSynonymImportPrecheckVO precheckSynonymImport(
            String filename, String contentType, byte[] bytes) {
        MultipartBodyBuilder builder = new MultipartBodyBuilder();
        ByteArrayResource resource = new ByteArrayResource(bytes) {
            @Override
            public String getFilename() {
                return filename;
            }
        };
        builder.part("file", resource)
                .filename(filename)
                .contentType(contentType != null
                        ? MediaType.parseMediaType(contentType)
                        : MediaType.APPLICATION_OCTET_STREAM);
        return blockSynonym(client().post()
                .uri("/internal/v1/kb/synonyms/import/precheck")
                .headers(loginContextHeaders())
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(BodyInserters.fromMultipartData(builder.build()))
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_PRECHECK);
    }

    /**
     * 导入阶段二 · 提交。
     *
     * @param request 提交请求（token + 同名规范词处置策略）
     * @return 执行计数
     */
    public KbSynonymImportCommitVO commitSynonymImport(KbSynonymImportCommitRequest request) {
        return blockSynonym(client().post()
                .uri("/internal/v1/kb/synonyms/import/commit")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(request)
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_COMMIT);
    }

    /**
     * 导入阶段三 · 下载未导入行。
     *
     * @param batchId 批次 ID
     * @return 文件载荷
     */
    public KbSynonymFileVO rejectedSynonymRows(Long batchId) {
        return blockSynonym(client().get()
                .uri("/internal/v1/kb/synonyms/import/{batchId}/rejected", batchId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(SYNONYM_RAW), SYNONYM_FILE);
    }

    // ------------------------------------------------------------------ 内部

    /**
     * 发起调用并把未定型的 {@code data} 转成目标类型；失败时<b>连同明细</b>抛出。
     *
     * @param mono   下游响应
     * @param target 成功态目标类型
     * @param <T>    目标类型
     * @return 成功态数据；下游 {@code data} 为空时返回 {@code null}
     */
    private <T> T blockSynonym(Mono<Result<JsonNode>> mono, TypeReference<T> target) {
        return resolveSynonym(awaitSynonym(mono), objectMapper, target);
    }

    /**
     * 发起调用但丢弃 {@code data}（删除等无返回体的端点）。
     *
     * <p>不复用 {@link #blockSynonym} 是因为那条路径会对 {@code data} 做类型转换，
     * 而删除成功时下游给的是 {@code null}；单开一条只判成败的通道更直白，
     * 也避免将来下游「顺手」在成功响应里加个字段就把删除打挂。
     *
     * @param mono 下游响应
     */
    private void discardSynonym(Mono<Result<JsonNode>> mono) {
        Result<JsonNode> result = awaitSynonym(mono);
        if (result == null) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "下游无响应");
        }
        if (!result.isSuccess()) {
            throw new BusinessException(
                    result.getCode(), result.getMessage(), toPlainData(objectMapper, result.getData()));
        }
    }

    /**
     * 阻塞取下游响应，把传输层故障归一成 {@link BusinessException}。
     *
     * @param mono 下游响应
     * @return 下游 {@code Result}；可能为 {@code null}
     */
    private Result<JsonNode> awaitSynonym(Mono<Result<JsonNode>> mono) {
        try {
            return mono.block(timeout());
        } catch (BusinessException ex) {
            throw ex;
        } catch (WebClientResponseException ex) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR,
                    "下游调用失败: HTTP " + ex.getStatusCode().value());
        } catch (Exception ex) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "下游调用失败: " + ex.getMessage());
        }
    }

    /**
     * 解包同义词端点的下游响应。
     *
     * <p><b>这是 40927 冲突明细能活着到前端的关键一跳</b>，故拆成静态方法以便直接单测
     * （见 {@code KbWebClientSynonymPayloadTest}）：
     * <ul>
     *   <li>下游成功 —— 把 {@code data} 按<b>成功态</b>类型转换后返回；</li>
     *   <li>下游失败 —— 把 {@code code} / {@code message} / <b>{@code data} 原样</b>
     *       装进 {@link BusinessException}。{@code data} 先摊平成
     *       {@code Map}/{@code List}/标量，由全局异常处理器写回响应体，
     *       形状与下游给的逐字段一致，<b>一个字段都不丢</b>。</li>
     * </ul>
     *
     * <p>失败分支<b>刻意不做类型转换</b>：错误态的 {@code data} 与成功态类型无关，
     * 一转就把 {@code {term, ownerGroupId, ownerCanonicalTerm}} 转没了。
     *
     * @param result 下游响应
     * @param mapper 转换用映射器
     * @param target 成功态目标类型
     * @param <T>    目标类型
     * @return 成功态数据；{@code data} 为空时返回 {@code null}
     */
    static <T> T resolveSynonym(Result<JsonNode> result, ObjectMapper mapper, TypeReference<T> target) {
        if (result == null) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "下游无响应");
        }
        if (!result.isSuccess()) {
            throw new BusinessException(
                    result.getCode(), result.getMessage(), toPlainData(mapper, result.getData()));
        }
        JsonNode data = result.getData();
        if (data == null || data.isNull()) {
            return null;
        }
        try {
            return mapper.convertValue(data, target);
        } catch (IllegalArgumentException ex) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR,
                    "下游响应解析失败: " + ex.getMessage());
        }
    }

    /**
     * 把错误态 {@code data} 摊平成普通 Java 结构。
     *
     * <p>不直接把 {@link JsonNode} 塞进异常，是为了让审计切面、日志与响应序列化
     * 面对的都是最普通的 {@code Map}/{@code List}/标量——{@code JsonNode} 能被
     * Jackson 正确写出，却会在别处（比如 {@code toString()} 拼日志）表现得不一样。
     *
     * @param mapper 转换用映射器
     * @param node   错误态明细节点，可为 {@code null}
     * @return 摊平后的对象；无明细时 {@code null}
     */
    private static Object toPlainData(ObjectMapper mapper, JsonNode node) {
        if (node == null || node.isNull()) {
            return null;
        }
        try {
            return mapper.convertValue(node, Object.class);
        } catch (IllegalArgumentException ex) {
            // 明细转换失败也绝不能把整个错误吞成 500：宁可退化成字符串，也要保住 code + message
            return node.toString();
        }
    }

    /**
     * 拼接带可选查询参数的下游 URI。
     *
     * <p>{@code null} 与空字符串一律跳过——把 {@code from=} 这种空参数发给下游，
     * 会被当成「传了但值为空」而不是「没传」，容易踩出莫名其妙的筛选结果。
     *
     * <h2>为什么返回函数而不是字符串（DEF-01 修复点，别改回去）</h2>
     * 旧实现返回 {@code builder.build().encode().toUriString()}，即一段<b>已经百分号编码</b>
     * 的字符串（{@code keyword=%E5%AD%A3%E5%BA%A6}），再交给 {@code uri(String)}。
     * 而 {@code WebClient} 的 {@code uri(String)} 走的是
     * {@code DefaultUriBuilderFactory}，默认编码模式 {@code TEMPLATE_AND_VALUES}
     * 会把整段模板<b>再编码一次</b>，已编码的 {@code %} 变成 {@code %25}：
     * {@code %E5%AD%A3%E5%BA%A6} → {@code %25E5%25AD%25A3%25E5%25BA%25A6}，
     * 空格 {@code %20} → {@code %2520}。下游解码后拿到的是字面量乱码，
     * 于是「含中文或空格的关键词一律命中 0 行」，而纯 ASCII 无空格的关键词
     * （没有任何字符需要编码，二次编码是恒等变换）看起来一切正常。
     *
     * <p>修复思路是<b>让编码只发生一次，且由 WebClient 自己做</b>：返回一个作用在
     * WebClient 自身 {@link UriBuilder} 上的函数，交给 {@code uri(Function)} 重载。
     * 该 builder 由 {@code DefaultUriBuilderFactory} 携带 baseUrl 产出，
     * 因此拼出来的是<b>绝对</b> URI，与既有 {@code uri(String)} 调用的寻址行为完全一致。
     *
     * <p><b>不要「简化」成返回 {@link URI}</b>：{@code uri(URI)} 会把 URI 原样当成最终地址
     * （{@code DefaultWebClient.initUri()} 直接返回它，不经过 {@code uriBuilderFactory}），
     * 相对路径 {@code /internal/...} 会丢掉 baseUrl 的 scheme/host/port，
     * 静默打到默认主机上——比双重编码更难查。
     *
     * <p>参数值一律以 {@code {p0}} 形式的 URI 变量占位，真值走
     * {@link UriBuilder#build(Map)} 展开：这样值里的 {@code &}、{@code =}、
     * 乃至 {@code &#123;}{@code &#125;} 都会被当成纯数据整体编码，既防查询串注入，
     * 也避免用户输入里的花括号被误解析成模板变量。
     *
     * @param path   路径（相对 baseUrl）
     * @param params 查询参数，值为原文（未编码）
     * @return 供 {@code WebClient.uri(Function)} 消费的 URI 构造函数
     */
    private static Function<UriBuilder, URI> buildUri(String path, Map<String, Object> params) {
        return uriBuilder -> {
            uriBuilder.path(path);
            Map<String, Object> uriVariables = new LinkedHashMap<>();
            if (params != null) {
                int index = 0;
                for (Map.Entry<String, Object> entry : params.entrySet()) {
                    Object value = entry.getValue();
                    if (value == null) {
                        continue;
                    }
                    String text = String.valueOf(value);
                    if (text.isBlank()) {
                        continue;
                    }
                    String variableName = "p" + index++;
                    uriBuilder.queryParam(entry.getKey(), "{" + variableName + "}");
                    uriVariables.put(variableName, text);
                }
            }
            return uriBuilder.build(uriVariables);
        };
    }
}
