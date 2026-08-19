package com.mis.adminbff.service;

import com.mis.adminbff.client.KbWebClient;
import com.mis.adminbff.dto.kb.KbAclSummaryVO;
import com.mis.adminbff.dto.kb.KbAclVO;
import com.mis.adminbff.dto.kb.KbAuditBefore;
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
import com.mis.adminbff.dto.kb.KbEngineReconcileVO;
import com.mis.adminbff.dto.kb.KbEngineRefVO;
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
import com.mis.adminbff.dto.kb.KbHitTestRequest;
import com.mis.adminbff.dto.kb.KbHitTestResultVO;
import com.mis.adminbff.dto.kb.KbRagSettings;
import com.mis.adminbff.dto.kb.KbReparseAllResultVO;
import com.mis.adminbff.dto.kb.KbSubjectVO;
import com.mis.adminbff.dto.kb.KbVisibilityVO;
import com.mis.adminbff.dto.kb.LegacyAclInventoryVO;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.common.web.audit.OperLog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
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

    /**
     * 修改分类（企业级增强一期 KE-01：审计快照入参，before=旧分类信息）。
     *
     * <p>{@code @OperLog} 挂门面方法而非 Controller：切面只能序列化方法入参，
     * 旧值必须以 {@code auditBefore} 形态出现在本次跨 Bean 调用上（deleteGroup 同款范式）。
     *
     * @param id          分类 id
     * @param name        新分类名
     * @param enabled     新启用状态
     * @param sort        新排序
     * @param remark      新备注
     * @param auditBefore 修改前快照（由 {@link #loadCategoryBefore} 取得；仅留痕，不参与业务）
     */
    @OperLog(module = "知识库", operation = "修改分类", recordParams = true)
    public KbCategoryVO updateCategory(Long id, String name, Integer enabled, Integer sort, String remark,
                                       KbAuditBefore auditBefore) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("enabled", enabled != null ? enabled : 1);
        body.put("sort", sort);
        body.put("remark", remark);
        return kbWebClient.updateCategory(id, body);
    }

    /**
     * 删除分类（KE-01：审计快照入参，before=删除前快照）。
     *
     * @param id          分类 id
     * @param auditBefore 删除前快照（由 {@link #loadCategoryBefore} 取得；仅留痕）
     */
    @OperLog(module = "知识库", operation = "删除分类", recordParams = true)
    public void deleteCategory(Long id, KbAuditBefore auditBefore) {
        kbWebClient.deleteCategory(id);
    }

    /** 管辖节点 id 列表（知识库域一期；纯透传）。 */
    public Set<Long> listManageableCategoryIds() {
        return kbWebClient.listManageableCategoryIds();
    }

    /** 移动分类节点（知识库域一期；纯透传 + 审计快照入参，before=旧分类信息含原 parentId）。 */
    @OperLog(module = "知识库", operation = "移动分类", recordParams = true)
    public KbCategoryVO moveCategory(Long id, Long newParentId, KbAuditBefore auditBefore) {
        return kbWebClient.moveCategory(id, newParentId);
    }

    // ------------------------------------------------------------------ 分类管理员（知识库域一期）

    public List<KbCategoryAdminVO> listCategoryAdmins(Long categoryId) {
        return kbWebClient.listCategoryAdmins(categoryId);
    }

    /**
     * 授予分类管理员（KE-01：审计快照入参，before=现有管理员列表）。
     *
     * @param categoryId  分类 id
     * @param subjectType 主体类型 user/role/dept
     * @param subjectId   主体 id
     * @param auditBefore 授予前快照（由 {@link #loadCategoryAdminListBefore} 取得；仅留痕）
     */
    @OperLog(module = "知识库", operation = "授予分类管理员", recordParams = true)
    public KbCategoryAdminVO grantCategoryAdmin(
            Long categoryId, String subjectType, Long subjectId, KbAuditBefore auditBefore) {
        Map<String, Object> body = new HashMap<>();
        body.put("subjectType", subjectType);
        body.put("subjectId", subjectId);
        return kbWebClient.grantCategoryAdmin(categoryId, body);
    }

    /**
     * 撤销分类管理员（KE-01：审计快照入参，before=目标管理员 id 最小快照）。
     *
     * <p>撤销端点只暴露 {@code adminId}，BFF 侧无「按 id 取管理员」读端点，
     * 故 before 取最小快照（adminId）；行级详情（subjectType/subjectId）随授予时的
     * 管理员列表快照留痕。
     *
     * @param adminId     管理员授权行 id
     * @param auditBefore 撤销前快照（最小快照；仅留痕）
     */
    @OperLog(module = "知识库", operation = "撤销分类管理员", recordParams = true)
    public void revokeCategoryAdmin(Long adminId, KbAuditBefore auditBefore) {
        kbWebClient.revokeCategoryAdmin(adminId);
    }

    // ------------------------------------------------------------------ 知识库

    /**
     * 知识库列表（KBP-06：{@code scope} 透传 mis-kb 数据面收敛）。
     *
     * @param categoryId 分类过滤；{@code null} = 不限制
     * @param scope      {@code manageable} / {@code visible} / {@code null}（= 现状全量）；
     *                   缺省/空/非法由 mis-kb 兜底为全量（零回归）
     */
    public List<KbLibraryVO> listLibraries(Long categoryId, String scope) {
        return kbWebClient.listLibraries(categoryId, scope);
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

    /**
     * 修改知识库（KE-01：审计快照入参，before=旧库元信息）。
     *
     * @param id          知识库 id
     * @param name        新库名
     * @param secrecy     新密级
     * @param status      新状态
     * @param settings    新 RAG 设置
     * @param auditBefore 修改前快照（由 {@link #loadLibraryBefore} 取得；仅留痕）
     */
    @OperLog(module = "知识库", operation = "修改知识库", recordParams = true)
    public KbLibraryVO updateLibrary(
            Long id, String name, String secrecy, Integer status, KbRagSettings settings,
            KbAuditBefore auditBefore) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", name);
        body.put("secrecy", secrecy);
        body.put("status", status);
        body.put("settings", settings);
        return kbWebClient.updateLibrary(id, body);
    }

    /**
     * 删除知识库（2 参重载，兼容既有调用方；等价于 {@code deleteLibrary(id, mode, false)}）。
     *
     * @param id   知识库 id
     * @param mode {@code archive}（默认）/ {@code physical}
     * @return 删除回执
     */
    public KbLibraryDeleteResultVO deleteLibrary(Long id, String mode) {
        return deleteLibrary(id, mode, false);
    }

    /**
     * 删除知识库（T04：{@code mode} 透传 + 回执透传；Q1 两段式确认流加 {@code force}）。
     *
     * <p><b>默认走归档</b>：不带 {@code mode} 时下游执行「引擎侧改名 + 本地停用」，
     * 不删任何数据。回执里的 {@code message} 原样透传给前端展示，不要在这层改写。
     *
     * <p><b>Q1 {@code force}：</b>第一段（force=false）若下游返回 {@code engineMissing=true}
     * 提示态，本层原样透传，由前端警示并要求确认后以 {@code force=true} 重调。
     * {@code force} 语义（只对 engineMissing 生效、不豁免其它失败）由 mis-kb 裁定，
     * 本层只做参数装配与透传。
     *
     * @param id    知识库 id
     * @param mode  {@code archive}（默认）/ {@code physical}
     * @param force 是否跳过引擎直接本地执行（仅对 engineMissing 生效，默认 false）
     * @return 删除回执
     */
    public KbLibraryDeleteResultVO deleteLibrary(Long id, String mode, boolean force) {
        String effective = (mode == null || mode.isBlank()) ? "archive" : mode.trim();
        return kbWebClient.deleteLibrary(id, effective, force);
    }

    /**
     * 查看知识库的引擎引用（Q4 有限暴露 dataset_id）。
     *
     * <p>判权由 {@code kb:library:engine-ref:view} 在网关注册表侧完成，审计由 Controller 的
     * {@code @OperLog} 完成，本层纯透传。
     *
     * @param id 知识库 id
     * @return 引擎引用视图
     */
    public KbEngineRefVO getEngineRef(Long id) {
        return kbWebClient.getEngineRef(id);
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

    /**
     * 保存知识库 RAG 设置（L-08；KE-01 审计快照入参，before=旧设置）。
     *
     * <p>{@code KbRagSettings} 本身不含 {@code java.time} 字段，可直接作为
     * {@code auditBefore.before} 值（KbAuditBefore 注释中的「RAG 设置例外」）。
     *
     * @param libraryId   知识库 id
     * @param settings    新设置
     * @param auditBefore 修改前快照（由 {@link #loadRagSettingsBefore} 取得；仅留痕）
     */
    @OperLog(module = "知识库", operation = "修改 RAG 设置", recordParams = true)
    public KbRagSettings updateRagSettings(Long libraryId, KbRagSettings settings, KbAuditBefore auditBefore) {
        return kbWebClient.updateRagSettings(libraryId, settings);
    }

    /**
     * 触发图谱构建（Wave B GraphRAG PoC，T02；BFF 三层透传）。
     *
     * <p>写操作：权限码 {@code kb:library:edit}（KbController 兜底 + 注册表主路径）+ 审计；
     * mis-kb 侧另有管辖/能力/上限/状态机校验。透传不做任何业务决策。
     */
    public KbGraphBuildResultVO buildGraph(Long libraryId) {
        return kbWebClient.buildGraph(libraryId);
    }

    /**
     * 查询图谱构建状态（Wave B GraphRAG PoC，T02；BFF 三层透传）。
     *
     * <p>读操作：权限码 {@code kb:library:engine-ref:view}，不挂审计（U6）。透传不做任何业务决策。
     */
    public KbGraphStatusVO graphBuildStatus(Long libraryId) {
        return kbWebClient.graphBuildStatus(libraryId);
    }

    /**
     * 触发 RAPTOR 摘要构建（Wave C RAPTOR，T02；BFF 三层透传）。
     *
     * <p>构建 = 写操作：权限码 {@code kb:library:edit} + {@code @OperLog} 审计在
     * {@code KbController} 收口；mis-kb 侧 {@code KbRaptorService.build} 另有管辖双闸门 +
     * 能力/状态机校验。本方法只透传，不做任何业务决策。U4：无库数上限。
     */
    public KbRaptorBuildResultVO buildRaptor(Long libraryId) {
        return kbWebClient.buildRaptor(libraryId);
    }

    /**
     * 查询 RAPTOR 构建状态（Wave C RAPTOR，T02；BFF 三层透传）。
     *
     * <p>读操作：权限码 {@code kb:library:engine-ref:view}，不挂审计（U6）。透传不做任何业务决策。
     */
    public KbRaptorStatusVO raptorBuildStatus(Long libraryId) {
        return kbWebClient.raptorBuildStatus(libraryId);
    }

    // ------------------------------------------------------------------ 文档

    public List<KbDocumentVO> listDocuments(Long libraryId) {
        return kbWebClient.listDocuments(libraryId);
    }

    public KbDocumentVO getDocument(Long libraryId, Long id) {
        return kbWebClient.getDocument(libraryId, id);
    }

    /**
     * 分页列举文档切片（「查看文档切分效果」；三层透传，不做业务决策）。
     *
     * <p>读操作：权限码 {@code kb:document:list}（BFF 侧 {@code requirePermission}
     * 兜底 + 注册表主路径），端点挂 {@code @OperLog} 审计留痕（见 {@code KbController}）。
     */
    public KbDocumentChunksVO listDocumentChunks(
            Long libraryId, Long id, String keywords, int page, int pageSize) {
        return kbWebClient.listDocumentChunks(libraryId, id, keywords, page, pageSize);
    }

    /** 拉取分片版面截图（直吐字节）。 */
    public byte[] getChunkImage(Long libraryId, Long id, String imageId) {
        return kbWebClient.getChunkImage(libraryId, id, imageId);
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

    /**
     * 启停文档（KE-01：审计快照入参，before=旧 enabled 等文档信息）。
     *
     * @param libraryId   知识库 id
     * @param id          文档 id
     * @param enabled     目标启用状态
     * @param auditBefore 修改前快照（由 {@link #loadDocumentBefore} 取得；仅留痕）
     */
    @OperLog(module = "知识库", operation = "启停文档", recordParams = true)
    public void setDocumentEnabled(Long libraryId, Long id, boolean enabled, KbAuditBefore auditBefore) {
        kbWebClient.setDocumentEnabled(libraryId, id, enabled);
    }

    public void reparseDocument(Long libraryId, Long id) {
        kbWebClient.reparseDocument(libraryId, id);
    }

    /**
     * 库级一键全部重解析（P1-1；KE-05 扩展 {@code onlyFailed=true} 仅重试失败文档；纯透传）。
     *
     * @param libraryId 知识库 id
     * @param onlyFailed 仅重试 {@code parse_status=failed} 文档；{@code false} = 全量
     * @return 批量结果
     */
    public KbReparseAllResultVO reparseAllDocuments(Long libraryId, boolean onlyFailed) {
        return kbWebClient.reparseAllDocuments(libraryId, onlyFailed);
    }

    /**
     * 更新文档级切片配置（kb_settings_model_chunk；KE-01 审计快照入参，before=旧文件级切片配置）。
     *
     * @param libraryId   知识库 id
     * @param docId       文档 id
     * @param body        新切片配置（chunkMethod/chunkTokenNum/separator；全 null=清空覆盖）
     * @param auditBefore 修改前快照（由 {@link #loadDocumentBefore} 取得；仅留痕）
     */
    @OperLog(module = "知识库", operation = "修改文档切片配置", recordParams = true)
    public void updateDocumentChunkConfig(
            Long libraryId, Long docId, Map<String, Object> body, KbAuditBefore auditBefore) {
        kbWebClient.updateDocumentChunkConfig(libraryId, docId, body);
    }

    /**
     * 删除文档（KE-01：审计快照入参，before=删除前快照）。
     *
     * @param libraryId   知识库 id
     * @param id          文档 id
     * @param auditBefore 删除前快照（由 {@link #loadDocumentBefore} 取得；仅留痕）
     */
    @OperLog(module = "知识库", operation = "删除文档", recordParams = true)
    public void deleteDocument(Long libraryId, Long id, KbAuditBefore auditBefore) {
        kbWebClient.deleteDocument(libraryId, id);
    }

    // ------------------------------------------------------------------ ACL

    /**
     * 列出库授权并批量回填主体名称（搜索权限页主体表用）。
     *
     * <p>名称解析失败<b>不阻断</b>整个接口：回填异常一律吞掉并降级返回原始列表，
     * 条目名称保持 {@code null}，前端降级展示 {@code subjectType + subjectId}。
     *
     * @param libraryId 知识库 id
     * @return ACL 列表（subjectName 已尽力回填；缺失保持 null）
     */
    public List<KbAclVO> listAcls(Long libraryId) {
        List<KbAclVO> acls = kbWebClient.listAcls(libraryId);
        try {
            return fillAclSubjectNames(acls);
        } catch (Exception e) {
            log.warn("回填 ACL 主体名称失败，降级返回原始列表: {}", e.getMessage());
            return acls != null ? acls : List.of();
        }
    }

    /**
     * 授予库权限（KE-01：审计快照入参，before=现有 ACL 列表）。
     *
     * @param libraryId   知识库 id
     * @param subjectType 主体类型 user/role/dept
     * @param subjectId   主体 id
     * @param action      权限动作（read/write/manage）
     * @param auditBefore 授予前快照（由 {@link #loadAclListBefore} 取得；仅留痕）
     */
    @OperLog(module = "知识库", operation = "授予库权限", recordParams = true)
    public KbAclVO grantAcl(Long libraryId, String subjectType, Long subjectId, String action,
                            KbAuditBefore auditBefore) {
        Map<String, Object> body = new HashMap<>();
        body.put("subjectType", subjectType);
        body.put("subjectId", subjectId);
        body.put("action", action);
        return kbWebClient.grantAcl(libraryId, body);
    }

    /**
     * 撤销库权限（KE-01：审计快照入参，before=目标 ACL 最小快照）。
     *
     * <p>撤销端点只暴露 {@code aclId}，BFF 侧无「按 id 取 ACL」读端点，
     * 故 before 取最小快照（aclId）；行级详情随授予时的 ACL 列表快照留痕。
     *
     * @param aclId       ACL 行 id
     * @param auditBefore 撤销前快照（最小快照；仅留痕）
     */
    @OperLog(module = "知识库", operation = "撤销库权限", recordParams = true)
    public void revokeAcl(Long aclId, KbAuditBefore auditBefore) {
        kbWebClient.revokeAcl(aclId);
    }

    /**
     * KBP-10 存量 manage/acl 只读清单（运营清理依据，只读不清理），并回填主体名称。
     *
     * <p><b>权限双闸门：</b>BFF 侧 {@code kb:acl:revoke} 权限码（Controller 兜底判权）+
     * mis-kb 侧 {@code isGlobalAdmin}（非全局管理员 40311）。
     *
     * @param libraryId   按库维度过滤；{@code null} = 不限制
     * @param subjectType 按主体类型过滤；{@code null} = 不限制
     * @param subjectId   按主体 id 过滤；{@code null} = 不限制
     * @return 存量授权清单（subjectName 已批量回填；回填失败保持 {@code null}）
     */
    public List<LegacyAclInventoryVO> listLegacyAclInventory(
            Long libraryId, String subjectType, Long subjectId) {
        List<LegacyAclInventoryVO> rows =
                kbWebClient.listLegacyAclInventory(libraryId, subjectType, subjectId);
        if (rows == null || rows.isEmpty()) {
            return rows != null ? rows : List.of();
        }
        Set<KbSubjectProxyService.SubjectKey> keys = new HashSet<>();
        for (LegacyAclInventoryVO row : rows) {
            if (row.subjectType() != null && row.subjectId() != null) {
                keys.add(new KbSubjectProxyService.SubjectKey(row.subjectType(), row.subjectId()));
            }
        }
        Map<String, String> names = subjectProxyService.resolveNames(keys);
        List<LegacyAclInventoryVO> result = new ArrayList<>(rows.size());
        for (LegacyAclInventoryVO row : rows) {
            String name = row.subjectType() == null || row.subjectId() == null
                    ? null
                    : names.get(row.subjectType().toLowerCase() + ":" + row.subjectId());
            result.add(new LegacyAclInventoryVO(
                    row.id(), row.libraryId(), row.libraryName(), row.categoryId(),
                    row.subjectType(), row.subjectId(), name, row.action(),
                    row.createdAt(), row.updatedAt()));
        }
        return result;
    }

    // ------------------------------------------------------------------ 审计快照采集（企业级增强一期 KE-01 / Q2）

    /**
     * 采集「修改/删除分类」前的旧值快照。
     *
     * <p><b>R2 铁律：</b>读旧值失败<b>不阻断主链路</b>——异常一律吞掉并回退最小快照
     * （仅 id），审计主干六要素不丢。快照字段只用 Jackson 免注册类型（无
     * {@code java.time}），避免裸 ObjectMapper 序列化炸掉整条 requestParams。
     *
     * @param id 分类 id
     * @return 快照包装，恒非 {@code null}
     */
    public KbAuditBefore loadCategoryBefore(Long id) {
        try {
            return kbWebClient.listCategories().stream()
                    .filter(c -> c != null && Objects.equals(c.id(), id))
                    .findFirst()
                    .map(c -> KbAuditBefore.of(id, c.name(), categorySnapshot(c)))
                    .orElseGet(() -> KbAuditBefore.minimal(id));
        } catch (Exception e) {
            log.warn("采集分类审计快照失败 id={}: {}", id, e.getMessage());
            return KbAuditBefore.minimal(id);
        }
    }

    /**
     * 采集「授予分类管理员」前的现有管理员列表快照。
     *
     * @param categoryId 分类 id
     * @return 快照包装（before=管理员行窄快照列表），恒非 {@code null}
     */
    public KbAuditBefore loadCategoryAdminListBefore(Long categoryId) {
        try {
            List<Object> admins = kbWebClient.listCategoryAdmins(categoryId).stream()
                    .filter(Objects::nonNull)
                    .map(KbFacadeService::categoryAdminSnapshot)
                    .map(a -> (Object) a)
                    .toList();
            return KbAuditBefore.of(categoryId, "分类管理员", admins);
        } catch (Exception e) {
            log.warn("采集分类管理员审计快照失败 categoryId={}: {}", categoryId, e.getMessage());
            return KbAuditBefore.minimal(categoryId);
        }
    }

    /**
     * 采集「修改知识库」前的旧库元信息快照。
     *
     * @param id 知识库 id
     * @return 快照包装，恒非 {@code null}
     */
    public KbAuditBefore loadLibraryBefore(Long id) {
        try {
            KbLibraryVO lib = kbWebClient.getLibrary(id);
            if (lib == null) {
                return KbAuditBefore.minimal(id);
            }
            return KbAuditBefore.of(id, lib.name(), librarySnapshot(lib));
        } catch (Exception e) {
            log.warn("采集知识库审计快照失败 id={}: {}", id, e.getMessage());
            return KbAuditBefore.minimal(id);
        }
    }

    /**
     * 采集「修改 RAG 设置」前的旧设置快照。
     *
     * <p>{@code KbRagSettings} 不含 {@code java.time}，可直接作 before（KbAuditBefore 例外）。
     *
     * @param libraryId 知识库 id
     * @return 快照包装（before=旧设置或 null），恒非 {@code null}
     */
    public KbAuditBefore loadRagSettingsBefore(Long libraryId) {
        try {
            KbRagSettings old = kbWebClient.getRagSettings(libraryId);
            if (old == null) {
                return KbAuditBefore.minimal(libraryId);
            }
            return KbAuditBefore.of(libraryId, "RAG 设置", old);
        } catch (Exception e) {
            log.warn("采集 RAG 设置审计快照失败 libraryId={}: {}", libraryId, e.getMessage());
            return KbAuditBefore.minimal(libraryId);
        }
    }

    /**
     * 采集「修改切片配置 / 启停 / 删除文档」前的旧文档快照。
     *
     * @param libraryId 知识库 id
     * @param id        文档 id
     * @return 快照包装，恒非 {@code null}
     */
    public KbAuditBefore loadDocumentBefore(Long libraryId, Long id) {
        try {
            KbDocumentVO doc = kbWebClient.getDocument(libraryId, id);
            if (doc == null) {
                return KbAuditBefore.minimal(id);
            }
            return KbAuditBefore.of(id, doc.title(), documentSnapshot(doc));
        } catch (Exception e) {
            log.warn("采集文档审计快照失败 libraryId={} id={}: {}", libraryId, id, e.getMessage());
            return KbAuditBefore.minimal(id);
        }
    }

    /**
     * 采集「授予库权限」前的现有 ACL 列表快照。
     *
     * @param libraryId 知识库 id
     * @return 快照包装（before=ACL 行窄快照列表），恒非 {@code null}
     */
    public KbAuditBefore loadAclListBefore(Long libraryId) {
        try {
            List<Object> acls = kbWebClient.listAcls(libraryId).stream()
                    .filter(Objects::nonNull)
                    .map(KbFacadeService::aclSnapshot)
                    .map(a -> (Object) a)
                    .toList();
            return KbAuditBefore.of(libraryId, "库权限", acls);
        } catch (Exception e) {
            log.warn("采集 ACL 审计快照失败 libraryId={}: {}", libraryId, e.getMessage());
            return KbAuditBefore.minimal(libraryId);
        }
    }

    /** 分类窄快照（仅 Jackson 免注册类型，剔除 Instant）。 */
    private static Map<String, Object> categorySnapshot(KbCategoryVO c) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", c.id());
        m.put("parentId", c.parentId());
        m.put("name", c.name());
        m.put("enabled", c.enabled());
        m.put("sort", c.sort());
        m.put("remark", c.remark());
        return m;
    }

    /** 分类管理员窄快照（剔除 Instant）。 */
    private static Map<String, Object> categoryAdminSnapshot(KbCategoryAdminVO a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.id());
        m.put("categoryId", a.categoryId());
        m.put("subjectType", a.subjectType());
        m.put("subjectId", a.subjectId());
        m.put("createdBy", a.createdBy());
        return m;
    }

    /** 知识库窄快照（剔除 Instant；settings 为不含 java.time 的 KbRagSettings，可直接嵌套）。 */
    private static Map<String, Object> librarySnapshot(KbLibraryVO l) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", l.id());
        m.put("categoryId", l.categoryId());
        m.put("name", l.name());
        m.put("secrecy", l.secrecy());
        m.put("status", l.status());
        m.put("owner", l.owner());
        m.put("engineType", l.engineType());
        m.put("docCount", l.docCount());
        m.put("settings", l.settings());
        return m;
    }

    /** 文档窄快照（剔除 Instant createdAt/updatedAt）。 */
    private static Map<String, Object> documentSnapshot(KbDocumentVO d) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", d.id());
        m.put("libraryId", d.libraryId());
        m.put("title", d.title());
        m.put("version", d.version());
        m.put("parseStatus", d.parseStatus());
        m.put("enabled", d.enabled());
        m.put("size", d.size());
        m.put("format", d.format());
        m.put("chunkMethod", d.chunkMethod());
        m.put("chunkTokenNum", d.chunkTokenNum());
        m.put("separator", d.separator());
        m.put("parseProgress", d.parseProgress());
        m.put("parseError", d.parseError());
        return m;
    }

    /** ACL 窄快照（剔除 Instant）。 */
    private static Map<String, Object> aclSnapshot(KbAclVO a) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", a.id());
        m.put("libraryId", a.libraryId());
        m.put("subjectType", a.subjectType());
        m.put("subjectId", a.subjectId());
        m.put("action", a.action());
        return m;
    }

    // ------------------------------------------------------------------ 问答历史 / 反馈

    public List<KbQaSessionVO> listMySessions() {
        return kbWebClient.listMySessions();
    }

    public KbQaSessionDetailVO getSessionDetail(Long sessionId) {
        return kbWebClient.getSessionDetail(sessionId);
    }

    /** 删除问答会话（用户侧软删除；纯透传，归属/幂等由 mis-kb 裁定）。 */
    public void deleteSession(Long sessionId) {
        kbWebClient.deleteSession(sessionId);
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

    /**
     * 标记问答反馈已处理/忽略（OP-05）。
     *
     * <p>处理人取当前登录人（登录上下文头透传 mis-kb），状态机 pending → handled/ignored
     * 单向终态、非法流转由 mis-kb 拒绝；本层只做参数装配与透传。
     *
     * @param feedbackId 反馈 id
     * @param status     目标状态：handled / ignored
     * @param note       处理备注；可空
     * @return 更新后的反馈视图（含处理状态五字段）
     */
    public KbQaFeedbackVO markFeedbackProcessed(Long feedbackId, String status, String note) {
        Map<String, Object> body = new HashMap<>();
        body.put("status", status);
        body.put("note", note);
        return kbWebClient.processFeedback(feedbackId, body);
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
     * @param sentiment   评价筛选：positive 好评 / negative 差评 / null 不限
     * @param keyword     提问关键字
     * @param page        页码
     * @param size        每页条数
     * @return 分页列表
     */
    public PageResult<KbQaSessionListVO> listOperationSessions(
            String from, String to, Long libraryId, Long userId,
            Boolean hasFeedback, String sentiment, String keyword, Integer page, Integer size) {
        Map<String, Object> params = new HashMap<>();
        params.put("from", from);
        params.put("to", to);
        params.put("libraryId", libraryId);
        params.put("userId", userId);
        params.put("hasFeedback", hasFeedback);
        params.put("sentiment", sentiment);
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
                    row.libraryIds(), row.hasFeedback(), row.accuracy(), row.helpful(),
                    row.offtopic(), row.citeError(), row.sentiment(), row.feedbackStatus(),
                    row.ticketStatus()));
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
     * @param sentiment   评价筛选：positive 好评 / negative 差评 / null 不限
     * @param keyword     提问关键字
     * @param desensitize 是否脱敏 userId（默认 true）
     * @return CSV 全文
     */
    public String exportCsv(
            String from, String to, Long libraryId, Long userId,
            Boolean hasFeedback, String sentiment, String keyword, Boolean desensitize) {
        Map<String, Object> params = new HashMap<>();
        params.put("from", from);
        params.put("to", to);
        params.put("libraryId", libraryId);
        params.put("userId", userId);
        params.put("hasFeedback", hasFeedback);
        params.put("sentiment", sentiment);
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

    /**
     * 批量回填 ACL 视图中的主体名称（搜索权限页主体表用）。
     *
     * <p>与 {@link #fillSubjectNames(List)} 同构，仅目标类型不同（{@code KbAclVO} 是 8 参
     * 全量视图，{@code KbAclSummaryVO} 是 4 参摘要，二者不能合并成一个泛型擦除同名方法）。
     * 名称解析不到/入参缺失时保持 {@code null}，由调用方 {@link #listAcls} 兜底异常降级。
     *
     * @param acls 原始 ACL 视图
     * @return 已回填名称的视图；解析失败的条目保持 {@code null} 名称
     */
    private List<KbAclVO> fillAclSubjectNames(List<KbAclVO> acls) {
        if (acls == null || acls.isEmpty()) {
            return acls != null ? acls : List.of();
        }
        Set<KbSubjectProxyService.SubjectKey> keys = new HashSet<>();
        for (KbAclVO acl : acls) {
            if (acl.subjectType() != null && acl.subjectId() != null) {
                keys.add(new KbSubjectProxyService.SubjectKey(acl.subjectType(), acl.subjectId()));
            }
        }
        Map<String, String> names = subjectProxyService.resolveNames(keys);
        List<KbAclVO> result = new ArrayList<>(acls.size());
        for (KbAclVO acl : acls) {
            String name = acl.subjectType() == null || acl.subjectId() == null
                    ? null
                    : names.get(acl.subjectType().toLowerCase() + ":" + acl.subjectId());
            result.add(new KbAclVO(
                    acl.id(), acl.libraryId(), acl.subjectType(), acl.subjectId(),
                    acl.action(), acl.createdAt(), acl.updatedAt(), name));
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
                    caps.hybridSupported() != null ? caps.hybridSupported() : false,
                    caps.deleteSupported() != null ? caps.deleteSupported() : false,
                    caps.parserOcrSupported() != null ? caps.parserOcrSupported() : false,
                    caps.parserOverlapSupported() != null ? caps.parserOverlapSupported() : false,
                    caps.graphSupported() != null ? caps.graphSupported() : false,
                    caps.raptorSupported() != null ? caps.raptorSupported() : false,
                    caps.parserTocSupported() != null ? caps.parserTocSupported() : false,
                    caps.parserImageTableContextSupported() != null
                            ? caps.parserImageTableContextSupported() : false);
        } catch (Exception e) {
            log.warn("取引擎能力失败: {}", e.getMessage());
            return unsupportedCapabilities(engineType);
        }
    }

    /**
     * 读取最近一次引擎对账报告（T04）。
     *
     * <p>纯透传。下游不可达<b>直接抛</b>——对账报告是运维决策依据，
     * 把异常降级成「空报告」会让人误以为「引擎与 MIS 完全一致」，比不显示更危险。
     *
     * @return 对账报告
     */
    public KbEngineReconcileVO engineReconcileReport() {
        return kbWebClient.engineReconcileReport();
    }

    /**
     * 手动触发一次引擎对账（T04）。
     *
     * @return 本次对账报告
     */
    public KbEngineReconcileVO runEngineReconcile() {
        return kbWebClient.runEngineReconcile();
    }

    /**
     * 列出引擎侧游离 dataset（P1-T3）。
     *
     * @param engineType 引擎类型；{@code null} 取当前引擎
     * @param resolved    0=待处理 1=已处置
     * @return 游离项视图列表
     */
    public List<KbEngineOrphanVO> listEngineOrphans(String engineType, int resolved) {
        return kbWebClient.listEngineOrphans(engineType, resolved);
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
        return kbWebClient.resolveEngineOrphan(engineType, nativeId, req);
    }

    /**
     * 存量 dataset 批量重命名（P1-T4，dry-run 或执行）。
     *
     * @param req 请求（dryRun / confirmToken / limit）
     * @return 本次结果
     */
    public KbEngineRenameResultVO renameDatasets(KbEngineRenameReq req) {
        return kbWebClient.renameDatasets(req);
    }

    /**
     * 回滚某批次的重命名（P1-T4）。
     *
     * @param batchId 原执行批次号
     * @return 回滚结果
     */
    public KbEngineRenameResultVO rollbackRenameDatasets(String batchId) {
        return kbWebClient.rollbackRenameDatasets(batchId);
    }

    /**
     * 最近的重命名日志（P1-T4）。
     *
     * @param limit 返回条数
     * @return 日志视图列表
     */
    public List<KbEngineRenameLogVO> listRenameLogs(int limit) {
        return kbWebClient.listRenameLogs(limit);
    }

    /**
     * 某批次的重命名日志（P1-T4）。
     *
     * @param batchId 批次号
     * @return 该批次日志视图列表
     */
    public List<KbEngineRenameLogVO> getRenameLogsByBatch(String batchId) {
        return kbWebClient.getRenameLogsByBatch(batchId);
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
     * @return 五项能力全 false 的声明（含 deleteSupported）
     */
    private static KbEngineCapabilitiesVO unsupportedCapabilities(String engineType) {
        return new KbEngineCapabilitiesVO(
                engineType, List.of("UNSUPPORTED"), false, false, false, false, false, false, false,
                false, false, false, false);
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
