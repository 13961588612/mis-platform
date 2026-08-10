package com.mis.adminbff.service;

import com.mis.adminbff.client.KbWebClient;
import com.mis.adminbff.dto.kb.KbAclSummaryVO;
import com.mis.adminbff.dto.kb.KbAclVO;
import com.mis.adminbff.dto.kb.KbCategoryAdminVO;
import com.mis.adminbff.dto.kb.KbCategoryVO;
import com.mis.adminbff.dto.kb.KbDashboardVO;
import com.mis.adminbff.dto.kb.KbDocumentUploadResponse;
import com.mis.adminbff.dto.kb.KbDocumentVO;
import com.mis.adminbff.dto.kb.KbEngineCapabilitiesVO;
import com.mis.adminbff.dto.kb.KbEngineHealthVO;
import com.mis.adminbff.dto.kb.KbEngineModelPoolVO;
import com.mis.adminbff.dto.kb.KbLibraryDetailVO;
import com.mis.adminbff.dto.kb.KbLibraryVO;
import com.mis.adminbff.dto.kb.KbQaExportRow;
import com.mis.adminbff.dto.kb.KbQaFeedbackVO;
import com.mis.adminbff.dto.kb.KbQaSessionDetailVO;
import com.mis.adminbff.dto.kb.KbQaSessionListVO;
import com.mis.adminbff.dto.kb.KbQaSessionVO;
import com.mis.adminbff.dto.kb.KbQaTicketVO;
import com.mis.adminbff.dto.kb.KbHitTestRequest;
import com.mis.adminbff.dto.kb.KbHitTestResultVO;
import com.mis.adminbff.dto.kb.KbRagSettings;
import com.mis.adminbff.dto.kb.KbReparseAllResultVO;
import com.mis.adminbff.dto.kb.KbSubjectVO;
import com.mis.adminbff.dto.kb.KbVisibilityVO;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 知识库聚合门面（T7）。
 *
 * <p>负责把前端 {@code /api/v1/kb/**} 请求编排到 mis-kb 的 {@code /internal/v1/kb/**}，
 * 并在需要时做跨端点聚合（如引擎健康 + 引擎类型合并为一个视图）。
 * 不做业务规则判断——可见性、ACL、editable_once 等一律由 mis-kb 领域层裁定。
 */
@Service
public class KbFacadeService {

    private static final Logger log = LoggerFactory.getLogger(KbFacadeService.class);

    /** 单个文档上传大小上限（50MB），超过直接拒绝，避免占满 BFF 堆内存。 */
    private static final long MAX_UPLOAD_BYTES = 50L * 1024 * 1024;

    private final KbWebClient kbWebClient;
    private final KbSubjectProxyService subjectProxyService;
    private final KbExportService exportService;

    public KbFacadeService(
            KbWebClient kbWebClient,
            KbSubjectProxyService subjectProxyService,
            KbExportService exportService) {
        this.kbWebClient = kbWebClient;
        this.subjectProxyService = subjectProxyService;
        this.exportService = exportService;
    }

    // ------------------------------------------------------------------ 分类

    public List<KbCategoryVO> listCategories() {
        return kbWebClient.listCategories();
    }

    public KbCategoryVO createCategory(String name, Long parentId, Integer enabled, Integer sort, String remark) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("parentId", parentId);
        body.put("enabled", enabled != null ? enabled : 1);
        body.put("sort", sort);
        body.put("remark", remark);
        return kbWebClient.createCategory(body);
    }

    public KbCategoryVO updateCategory(Long id, String name, Integer enabled, Integer sort, String remark) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("enabled", enabled != null ? enabled : 1);
        body.put("sort", sort);
        body.put("remark", remark);
        return kbWebClient.updateCategory(id, body);
    }

    public void deleteCategory(Long id) {
        kbWebClient.deleteCategory(id);
    }

    /** 管辖节点 id 列表（知识库域一期；纯透传）。 */
    public Set<Long> listManageableCategoryIds() {
        return kbWebClient.listManageableCategoryIds();
    }

    /** 移动分类节点（知识库域一期；纯透传）。 */
    public KbCategoryVO moveCategory(Long id, Long newParentId) {
        return kbWebClient.moveCategory(id, newParentId);
    }

    // ------------------------------------------------------------------ 分类管理员（知识库域一期）

    public List<KbCategoryAdminVO> listCategoryAdmins(Long categoryId) {
        return kbWebClient.listCategoryAdmins(categoryId);
    }

    public KbCategoryAdminVO grantCategoryAdmin(Long categoryId, String subjectType, Long subjectId) {
        Map<String, Object> body = new HashMap<>();
        body.put("subjectType", subjectType);
        body.put("subjectId", subjectId);
        return kbWebClient.grantCategoryAdmin(categoryId, body);
    }

    public void revokeCategoryAdmin(Long adminId) {
        kbWebClient.revokeCategoryAdmin(adminId);
    }

    // ------------------------------------------------------------------ 知识库

    public List<KbLibraryVO> listLibraries(Long categoryId) {
        return kbWebClient.listLibraries(categoryId);
    }

    public KbLibraryVO getLibrary(Long id) {
        return kbWebClient.getLibrary(id);
    }

    public KbLibraryVO createLibrary(
            Long categoryId, String name, String secrecy, Long owner, KbRagSettings settings) {
        Map<String, Object> body = new HashMap<>();
        body.put("categoryId", categoryId);
        body.put("name", name);
        body.put("secrecy", secrecy);
        // owner 缺省取当前登录用户；mis-kb 侧也有同样兜底
        body.put("owner", owner != null ? owner : RequestContext.currentUserId());
        body.put("settings", settings);
        return kbWebClient.createLibrary(body);
    }

    public KbLibraryVO updateLibrary(
            Long id, String name, String secrecy, Integer status, KbRagSettings settings) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("secrecy", secrecy);
        body.put("status", status);
        body.put("settings", settings);
        return kbWebClient.updateLibrary(id, body);
    }

    public void deleteLibrary(Long id) {
        kbWebClient.deleteLibrary(id);
    }

    /**
     * 知识库详情聚合（L-06），并回填授权主体名称。
     *
     * @param id 知识库 id
     * @return 详情视图
     */
    public KbLibraryDetailVO getLibraryDetail(Long id) {
        KbLibraryDetailVO detail = kbWebClient.getLibraryDetail(id);
        if (detail == null) {
            return null;
        }
        return new KbLibraryDetailVO(
                detail.meta(),
                detail.docCount(),
                fillSubjectNames(detail.aclSummary()),
                detail.ragSettings());
    }

    /** 读取知识库 RAG 设置（L-08）。 */
    public KbRagSettings getRagSettings(Long libraryId) {
        return kbWebClient.getRagSettings(libraryId);
    }

    /** 保存知识库 RAG 设置（L-08）。 */
    public KbRagSettings updateRagSettings(Long libraryId, KbRagSettings settings) {
        return kbWebClient.updateRagSettings(libraryId, settings);
    }

    // ------------------------------------------------------------------ 文档

    public List<KbDocumentVO> listDocuments(Long libraryId) {
        return kbWebClient.listDocuments(libraryId);
    }

    public KbDocumentVO getDocument(Long libraryId, Long id) {
        return kbWebClient.getDocument(libraryId, id);
    }

    /** 透传文档上传；BFF 侧只做大小/空文件校验，解析交给引擎。可选文件级切片参数。 */
    public KbDocumentUploadResponse uploadDocument(
            Long libraryId, MultipartFile file,
            String chunkMethod, Integer chunkTokenNum, String separator) {
        if (file == null || file.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "上传文件不能为空");
        }
        if (file.getSize() > MAX_UPLOAD_BYTES) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "文件超过 50MB 上限");
        }
        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException e) {
            log.warn("读取上传文件失败 libraryId={}: {}", libraryId, e.getMessage());
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "读取上传文件失败");
        }
        String filename = file.getOriginalFilename() != null && !file.getOriginalFilename().isBlank()
                ? file.getOriginalFilename()
                : "upload.bin";
        return kbWebClient.uploadDocument(libraryId, filename, file.getContentType(), bytes,
                chunkMethod, chunkTokenNum, separator);
    }

    public void setDocumentEnabled(Long libraryId, Long id, boolean enabled) {
        kbWebClient.setDocumentEnabled(libraryId, id, enabled);
    }

    public void reparseDocument(Long libraryId, Long id) {
        kbWebClient.reparseDocument(libraryId, id);
    }

    /** 库级一键全部重解析（P1-1：换嵌入模型后全量重解析恢复检索；纯透传）。 */
    public KbReparseAllResultVO reparseAllDocuments(Long libraryId) {
        return kbWebClient.reparseAllDocuments(libraryId);
    }

    /** 更新文档级切片配置（kb_settings_model_chunk；改参触发重解析）。 */
    public void updateDocumentChunkConfig(Long libraryId, Long docId, Map<String, Object> body) {
        kbWebClient.updateDocumentChunkConfig(libraryId, docId, body);
    }

    public void deleteDocument(Long libraryId, Long id) {
        kbWebClient.deleteDocument(libraryId, id);
    }

    // ------------------------------------------------------------------ ACL

    public List<KbAclVO> listAcls(Long libraryId) {
        return kbWebClient.listAcls(libraryId);
    }

    public KbAclVO grantAcl(Long libraryId, String subjectType, Long subjectId, String action) {
        Map<String, Object> body = new HashMap<>();
        body.put("subjectType", subjectType);
        body.put("subjectId", subjectId);
        body.put("action", action);
        return kbWebClient.grantAcl(libraryId, body);
    }

    public void revokeAcl(Long aclId) {
        kbWebClient.revokeAcl(aclId);
    }

    // ------------------------------------------------------------------ 问答历史 / 反馈

    public List<KbQaSessionVO> listMySessions() {
        return kbWebClient.listMySessions();
    }

    public KbQaSessionDetailVO getSessionDetail(Long sessionId) {
        return kbWebClient.getSessionDetail(sessionId);
    }

    public KbQaFeedbackVO submitFeedback(
            Long sessionId, Integer accuracy, Integer helpful, Integer offtopic, Integer citeError) {
        Map<String, Object> body = new HashMap<>();
        body.put("sessionId", sessionId);
        body.put("accuracy", accuracy);
        body.put("helpful", helpful);
        body.put("offtopic", offtopic);
        body.put("citeError", citeError);
        return kbWebClient.submitFeedback(body);
    }

    public KbQaFeedbackVO getFeedback(Long sessionId) {
        return kbWebClient.getFeedback(sessionId);
    }

    // ------------------------------------------------------------------ 运营（只读）

    public List<KbQaSessionVO> listAllSessions() {
        return kbWebClient.listAllSessions();
    }

    public List<KbQaFeedbackVO> listAllFeedback() {
        return kbWebClient.listAllFeedback();
    }

    /**
     * 运营问答列表（A-02b），并回填提问人姓名。
     *
     * @param from        起始时间（ISO-8601 或 epoch 毫秒）
     * @param to          结束时间
     * @param libraryId   命中知识库 id
     * @param userId      提问用户 id
     * @param hasFeedback 是否已反馈
     * @param keyword     提问关键字
     * @param page        页码
     * @param size        每页条数
     * @return 分页列表
     */
    public PageResult<KbQaSessionListVO> listOperationSessions(
            String from, String to, Long libraryId, Long userId,
            Boolean hasFeedback, String keyword, Integer page, Integer size) {
        Map<String, Object> params = new HashMap<>();
        params.put("from", from);
        params.put("to", to);
        params.put("libraryId", libraryId);
        params.put("userId", userId);
        params.put("hasFeedback", hasFeedback);
        params.put("keyword", keyword);
        params.put("page", page);
        params.put("size", size);

        PageResult<KbQaSessionListVO> result = kbWebClient.listOperationSessions(params);
        if (result == null || result.getList() == null || result.getList().isEmpty()) {
            return result != null ? result : PageResult.empty(page != null ? page : 1, size != null ? size : 20);
        }
        Set<Long> userIds = new LinkedHashSet<>();
        for (KbQaSessionListVO row : result.getList()) {
            if (row.userId() != null) {
                userIds.add(row.userId());
            }
        }
        Map<Long, String> names = subjectProxyService.userNames(userIds);
        List<KbQaSessionListVO> enriched = new ArrayList<>(result.getList().size());
        for (KbQaSessionListVO row : result.getList()) {
            enriched.add(new KbQaSessionListVO(
                    row.id(), row.userId(), names.get(row.userId()), row.appId(), row.createdAt(),
                    row.question(), row.answerBrief(), row.messageCount(), row.citeCount(),
                    row.libraryIds(), row.hasFeedback(), row.accuracy(), row.helpful()));
        }
        return PageResult.of(result.getPage(), result.getSize(), result.getTotal(), enriched);
    }

    /**
     * 运营问答详情（A-02a），并回填可见范围中的主体名称。
     *
     * @param sessionId 会话 id
     * @return 会话详情
     */
    public KbQaSessionDetailVO getOperationSessionDetail(Long sessionId) {
        KbQaSessionDetailVO detail = kbWebClient.getOperationSessionDetail(sessionId);
        if (detail == null || detail.visibility() == null) {
            return detail;
        }
        KbVisibilityVO visibility = detail.visibility();
        List<KbAclSummaryVO> filled = fillSubjectNames(visibility.acls());
        return new KbQaSessionDetailVO(
                detail.session(),
                detail.messages(),
                detail.feedback(),
                new KbVisibilityVO(visibility.secrecy(), filled),
                detail.recallParams());
    }

    /**
     * 评价看板（A-02b/d）。
     *
     * @param from 起始时间
     * @param to   结束时间
     * @return 看板数据
     */
    public KbDashboardVO stats(String from, String to) {
        Map<String, Object> params = new HashMap<>();
        params.put("from", from);
        params.put("to", to);
        return kbWebClient.stats(params);
    }

    /**
     * 导出运营记录 CSV（A-02e）。
     *
     * @param from        起始时间
     * @param to          结束时间
     * @param libraryId   命中知识库 id
     * @param userId      提问用户 id
     * @param hasFeedback 是否已反馈
     * @param keyword     提问关键字
     * @param desensitize 是否脱敏 userId（默认 true）
     * @return CSV 全文
     */
    public String exportCsv(
            String from, String to, Long libraryId, Long userId,
            Boolean hasFeedback, String keyword, Boolean desensitize) {
        Map<String, Object> params = new HashMap<>();
        params.put("from", from);
        params.put("to", to);
        params.put("libraryId", libraryId);
        params.put("userId", userId);
        params.put("hasFeedback", hasFeedback);
        params.put("keyword", keyword);
        List<KbQaExportRow> rows = kbWebClient.exportRows(params);
        return exportService.toCsv(rows, desensitize == null || desensitize);
    }

    /** 导出文件名。 */
    public String exportFilename() {
        return exportService.buildFilename("kb-qa-export");
    }

    // ------------------------------------------------------------------ 工单（F-10 / A-02c）

    /**
     * 建工单（F-10）。
     *
     * @param sessionId 会话 id
     * @param messageId 消息 id；可空
     * @param type      工单类型
     * @param content   提单内容
     * @return 新建工单
     */
    public KbQaTicketVO createTicket(Long sessionId, Long messageId, String type, String content) {
        Map<String, Object> body = new HashMap<>();
        body.put("sessionId", sessionId);
        body.put("messageId", messageId);
        body.put("type", type);
        body.put("content", content);
        return kbWebClient.createTicket(body);
    }

    /**
     * 工单列表（A-02c）。
     *
     * @param status 状态筛选
     * @param page   页码
     * @param size   每页条数
     * @return 分页工单
     */
    public PageResult<KbQaTicketVO> listTickets(String status, Integer page, Integer size) {
        Map<String, Object> params = new HashMap<>();
        params.put("status", status);
        params.put("page", page);
        params.put("size", size);
        return kbWebClient.listTickets(params);
    }

    /** 工单详情。 */
    public KbQaTicketVO getTicket(Long ticketId) {
        return kbWebClient.getTicket(ticketId);
    }

    /**
     * 处理/关闭工单（A-02c）。
     *
     * <p>PATCH 语义：只把<b>非空</b>字段放进请求体。这里必须逐字段判空而不是无脑塞 map，
     * 否则前端只想改状态时会把 note 一并覆盖成 null。
     *
     * @param ticketId    工单 id
     * @param status      目标状态；可空
     * @param note        处理备注；可空
     * @param relAction   关联动作；可空
     * @param processorId 处理人；可空（下游会用当前登录人兜底）
     * @return 更新后的工单
     */
    public KbQaTicketVO patchTicket(
            Long ticketId, String status, String note, String relAction, Long processorId) {
        Map<String, Object> body = new HashMap<>();
        if (status != null && !status.isBlank()) {
            body.put("status", status);
        }
        if (note != null) {
            body.put("note", note);
        }
        if (relAction != null && !relAction.isBlank()) {
            body.put("relAction", relAction);
        }
        if (processorId != null) {
            body.put("processorId", processorId);
        }
        return kbWebClient.patchTicket(ticketId, body);
    }

    /** 某会话下的工单列表。 */
    public List<KbQaTicketVO> listTicketsBySession(Long sessionId) {
        return kbWebClient.listTicketsBySession(sessionId);
    }

    // ------------------------------------------------------------------ 主体检索（I-03）

    /**
     * 授权主体检索。
     *
     * @param type    主体类型 user/role/dept
     * @param keyword 关键字
     * @return 主体列表（dept 为树形）
     */
    public List<KbSubjectVO> searchSubjects(String type, String keyword) {
        return subjectProxyService.search(type, keyword);
    }

    // ------------------------------------------------------------------ 内部

    /**
     * 批量回填 ACL 摘要中的主体名称。
     *
     * @param acls 原始摘要
     * @return 已回填名称的摘要；解析失败的条目保持 {@code null} 名称
     */
    private List<KbAclSummaryVO> fillSubjectNames(List<KbAclSummaryVO> acls) {
        if (acls == null || acls.isEmpty()) {
            return acls != null ? acls : List.of();
        }
        Set<KbSubjectProxyService.SubjectKey> keys = new HashSet<>();
        for (KbAclSummaryVO acl : acls) {
            if (acl.subjectType() != null && acl.subjectId() != null) {
                keys.add(new KbSubjectProxyService.SubjectKey(acl.subjectType(), acl.subjectId()));
            }
        }
        Map<String, String> names = subjectProxyService.resolveNames(keys);
        List<KbAclSummaryVO> result = new ArrayList<>(acls.size());
        for (KbAclSummaryVO acl : acls) {
            String name = acl.subjectType() == null || acl.subjectId() == null
                    ? null
                    : names.get(acl.subjectType().toLowerCase() + ":" + acl.subjectId());
            result.add(new KbAclSummaryVO(acl.subjectType(), acl.subjectId(), name, acl.action()));
        }
        return result;
    }

    // ------------------------------------------------------------------ 引擎（S-04）

    /**
     * 引擎健康 + 引擎类型聚合。
     *
     * <p>下游 {@code /engine/health} 只返回 healthy/status/detail，此处补齐 engineType，
     * 使前端一次请求即可渲染“引擎”页顶部状态条。下游不可达时降级为 DOWN，不抛异常打断页面。
     */
    public KbEngineHealthVO engineHealth() {
        String engineType;
        try {
            engineType = kbWebClient.engineType();
        } catch (Exception e) {
            log.warn("取引擎类型失败: {}", e.getMessage());
            engineType = "unknown";
        }
        try {
            KbEngineHealthVO health = kbWebClient.engineHealth();
            if (health == null) {
                return new KbEngineHealthVO(engineType, false, "DOWN", "下游无响应");
            }
            return new KbEngineHealthVO(
                    engineType,
                    health.healthy() != null ? health.healthy() : false,
                    health.status() != null ? health.status() : "DOWN",
                    health.detail());
        } catch (Exception e) {
            log.warn("引擎健康检查失败: {}", e.getMessage());
            return new KbEngineHealthVO(engineType, false, "DOWN", e.getMessage());
        }
    }

    /** 引擎能力 + 引擎类型聚合；下游不可达时降级为“全不支持”。 */
    public KbEngineCapabilitiesVO engineCapabilities() {
        String engineType;
        try {
            engineType = kbWebClient.engineType();
        } catch (Exception e) {
            log.warn("取引擎类型失败: {}", e.getMessage());
            engineType = "unknown";
        }
        try {
            KbEngineCapabilitiesVO caps = kbWebClient.engineCapabilities();
            if (caps == null) {
                return unsupportedCapabilities(engineType);
            }
            return new KbEngineCapabilitiesVO(
                    engineType,
                    caps.capabilities() != null ? caps.capabilities() : List.of(),
                    caps.rerankSupported() != null ? caps.rerankSupported() : false,
                    caps.metadataFilterSupported() != null ? caps.metadataFilterSupported() : false,
                    caps.replaceSupported() != null ? caps.replaceSupported() : false,
                    caps.hybridSupported() != null ? caps.hybridSupported() : false);
        } catch (Exception e) {
            log.warn("取引擎能力失败: {}", e.getMessage());
            return unsupportedCapabilities(engineType);
        }
    }

    /**
     * 模型池（kb_settings_model_chunk；纯透传）。
     *
     * <p>mis-kb 已按降级语义返回 {@code available=false + degradedReason}（绝不空列表），
     * 本层只透传；下游不可达时补一个同语义的降级池，避免前端把异常当成「平台没有模型」。
     *
     * @return 模型池视图，恒非 {@code null}
     */
    public KbEngineModelPoolVO listEngineModels() {
        try {
            KbEngineModelPoolVO pool = kbWebClient.listEngineModels();
            if (pool == null) {
                return new KbEngineModelPoolVO(List.of(), List.of(), false, "下游无响应", null, null);
            }
            return pool;
        } catch (Exception e) {
            log.warn("取模型池失败: {}", e.getMessage());
            return new KbEngineModelPoolVO(
                    List.of(), List.of(), false, "模型池探测失败：" + e.getMessage(), null, null);
        }
    }

    /**
     * 下游不可达时的能力降级值：全不支持。
     *
     * <p>刻意<b>不</b>返回「乐观默认」——能力探测失败时假装支持 hybrid/rerank，
     * 前端就会把开关亮出来让人配，配完保存又发现引擎根本不认，属于误导。
     *
     * @param engineType 引擎类型（可能是 "unknown"）
     * @return 四项能力全 false 的声明
     */
    private static KbEngineCapabilitiesVO unsupportedCapabilities(String engineType) {
        return new KbEngineCapabilitiesVO(
                engineType, List.of("UNSUPPORTED"), false, false, false, false);
    }

    // ------------------------------------------------------------------ 命中测试（Q-04 / WA-07）

    /**
     * 执行命中测试。
     *
     * <p>纯透传：单库校验、ACL、参数合并、降级全部由 mis-kb 裁定，BFF 不做任何业务加工。
     * 失败<b>直接抛出</b>而不降级为空结果——命中测试是调参工具，把引擎异常吞成
     * 「零命中」会让管理员误判成参数问题，白白浪费时间（§7.5-6 错误处理分野）。
     *
     * @param request 命中测试请求
     * @return 命中结果；下游返回 null 视为异常
     */
    public KbHitTestResultVO hitTest(KbHitTestRequest request) {
        return kbWebClient.hitTest(request);
    }
}
