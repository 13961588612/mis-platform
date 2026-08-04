package com.mis.adminbff.client;

import com.mis.adminbff.config.BffProperties;
import com.mis.adminbff.dto.kb.KbAclVO;
import com.mis.adminbff.dto.kb.KbCategoryVO;
import com.mis.adminbff.dto.kb.KbDashboardVO;
import com.mis.adminbff.dto.kb.KbDocumentUploadResponse;
import com.mis.adminbff.dto.kb.KbDocumentVO;
import com.mis.adminbff.dto.kb.KbEngineCapabilitiesVO;
import com.mis.adminbff.dto.kb.KbEngineHealthVO;
import com.mis.adminbff.dto.kb.KbHitTestRequest;
import com.mis.adminbff.dto.kb.KbHitTestResultVO;
import com.mis.adminbff.dto.kb.KbLibraryDetailVO;
import com.mis.adminbff.dto.kb.KbLibraryVO;
import com.mis.adminbff.dto.kb.KbQaExportRow;
import com.mis.adminbff.dto.kb.KbQaFeedbackVO;
import com.mis.adminbff.dto.kb.KbQaSessionDetailVO;
import com.mis.adminbff.dto.kb.KbQaSessionListVO;
import com.mis.adminbff.dto.kb.KbQaSessionVO;
import com.mis.adminbff.dto.kb.KbQaTicketVO;
import com.mis.adminbff.dto.kb.KbRagSettings;
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
import org.springframework.web.util.UriComponentsBuilder;

import java.util.List;
import java.util.Map;

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
    private static final ParameterizedTypeReference<Result<KbDocumentUploadResponse>> UPLOAD =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<List<KbAclVO>>> ACL_LIST =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<Result<KbAclVO>> ACL =
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

    public KbWebClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            @Qualifier("loadBalancedWebClientBuilder") WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        super(buildClient(plainBuilder, loadBalancedBuilder, properties), properties.getAggregateTimeoutMs());
    }

    private static WebClient buildClient(
            WebClient.Builder plainBuilder,
            WebClient.Builder loadBalancedBuilder,
            BffProperties properties) {
        WebClient.Builder builder = properties.isKbDiscoveryEnabled() ? loadBalancedBuilder : plainBuilder;
        return builder.baseUrl(resolveBaseUrl(
                properties.isKbDiscoveryEnabled(),
                properties.getKbServiceId(),
                properties.getKbBaseUrl())).build();
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

    // ------------------------------------------------------------------ 知识库

    public List<KbLibraryVO> listLibraries(Long categoryId) {
        UriComponentsBuilder uri = UriComponentsBuilder.fromPath("/internal/v1/kb/libraries");
        if (categoryId != null) {
            uri.queryParam("categoryId", categoryId);
        }
        List<KbLibraryVO> data = block(client().get()
                .uri(uri.build(true).toUriString())
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

    public void deleteLibrary(Long id) {
        block(client().delete()
                .uri("/internal/v1/kb/libraries/{id}", id)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(VOID));
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

    /** 透传 multipart 上传（保留原始文件名与内容类型）。 */
    public KbDocumentUploadResponse uploadDocument(
            Long libraryId, String filename, String contentType, byte[] bytes) {
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

    public String engineType() {
        return block(client().get()
                .uri("/internal/v1/kb/engine/type")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(STRING));
    }

    // ------------------------------------------------------------------ 内部

    /**
     * 拼接带可选查询参数的 URI。
     *
     * <p>{@code null} 与空字符串一律跳过——把 {@code from=} 这种空参数发给下游，
     * 会被当成「传了但值为空」而不是「没传」，容易踩出莫名其妙的筛选结果。
     *
     * @param path   路径
     * @param params 查询参数
     * @return 已编码的 URI 字符串
     */
    private static String buildUri(String path, Map<String, Object> params) {
        UriComponentsBuilder builder = UriComponentsBuilder.fromPath(path);
        if (params != null) {
            for (Map.Entry<String, Object> entry : params.entrySet()) {
                Object value = entry.getValue();
                if (value == null) {
                    continue;
                }
                String text = String.valueOf(value);
                if (text.isBlank()) {
                    continue;
                }
                builder.queryParam(entry.getKey(), text);
            }
        }
        return builder.build().encode().toUriString();
    }
}
