package com.mis.adminbff.controller;

import com.mis.adminbff.dto.kb.KbAclVO;
import com.mis.adminbff.dto.kb.KbAuditBefore;
import com.mis.adminbff.dto.kb.KbCategoryAdminCreateRequest;
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
import com.mis.adminbff.dto.kb.KbGraphBuildResultVO;
import com.mis.adminbff.dto.kb.KbGraphStatusVO;
import com.mis.adminbff.dto.kb.KbHitTestRequest;
import com.mis.adminbff.dto.kb.KbHitTestResultVO;
import com.mis.adminbff.dto.kb.KbLibraryDeleteResultVO;
import com.mis.adminbff.dto.kb.KbLibraryDetailVO;
import com.mis.adminbff.dto.kb.KbLibraryVO;
import com.mis.adminbff.dto.kb.KbQaFeedbackVO;
import com.mis.adminbff.dto.kb.KbQaSessionDetailVO;
import com.mis.adminbff.dto.kb.KbQaSessionListVO;
import com.mis.adminbff.dto.kb.KbQaSessionVO;
import com.mis.adminbff.dto.kb.KbQaTicketVO;
import com.mis.adminbff.dto.kb.KbRagSettings;
import com.mis.adminbff.dto.kb.KbRaptorBuildResultVO;
import com.mis.adminbff.dto.kb.KbRaptorStatusVO;
import com.mis.adminbff.dto.kb.KbReparseAllResultVO;
import com.mis.adminbff.dto.kb.KbSubjectVO;
import com.mis.adminbff.dto.kb.LegacyAclInventoryVO;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.service.KbFacadeService;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.web.audit.OperLog;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 知识库 BFF 聚合端点（前端唯一入口）。
 *
 * <p>路径前缀 {@code /api/v1/kb/**}，全部委托 {@link KbFacadeService} 编排到 mis-kb。
 * 业务规则（可见性/ACL/editable_once/密级校验）由 mis-kb 裁定，本层仅做参数装配与大小校验。
 */
@RestController
@RequestMapping("/api/v1/kb")
public class KbController {

    /**
     * 命中测试权限码。取值必须与 V17__kb_hittest_perms.sql 写入
     * {@code sys_menu(id=91039).permission} 的字面量保持一致。
     */
    private static final String PERM_HIT_TEST_RUN = "kb:hittest:run";

    /**
     * 分类管理权限码（知识库域一期）。取值必须与 V24__kb_category_admin.sql 写入
     * {@code sys_menu(id=91052).permission} 的字面量保持一致；用于「设置管理员/移动」功能门控。
     */
    private static final String PERM_CATEGORY_MANAGE = "kb:category:manage";

    /**
     * 知识库编辑权限码（Wave B GraphRAG PoC，T02；构图 = 写操作）。
     * 取值必须与既有 {@code sys_menu(id=91044).permission} 字面量保持一致。
     */
    private static final String PERM_LIBRARY_EDIT = "kb:library:edit";

    /**
     * 引擎引用查看权限码（Wave B GraphRAG PoC，T02；状态查询 = 读操作，不挂审计）。
     * 取值必须与既有 {@code sys_menu(id=91056).permission} 字面量保持一致。
     */
    private static final String PERM_LIBRARY_ENGINE_REF_VIEW = "kb:library:engine-ref:view";

    /**
     * ACL 撤销权限码（KBP-10 存量只读清单的 BFF 侧兜底判权）。
     * 取值必须与 V14 写入 {@code sys_menu(id=91050).permission} 的字面量保持一致；
     * mis-kb 侧另有 {@code isGlobalAdmin} 二次裁定（双闸门）。
     */
    private static final String PERM_ACL_REVOKE = "kb:acl:revoke";

    /**
     * 文档列表/详情读取权限码（「查看文档切分效果」）。
     * 取值必须与 V32 写入 {@code sys_menu(id=91130/91131).permission} 的字面量保持一致；
     * mis-kb 侧另有 {@code KbVisibilityService.hasPermission} ACL 读权限二次裁定（双闸门）。
     */
    private static final String PERM_DOCUMENT_LIST = "kb:document:list";

    private final KbFacadeService kbFacadeService;
    private final UserPermissionLoader userPermissionLoader;

    public KbController(KbFacadeService kbFacadeService, UserPermissionLoader userPermissionLoader) {
        this.kbFacadeService = kbFacadeService;
        this.userPermissionLoader = userPermissionLoader;
    }

    // ------------------------------------------------------------------ 分类

    @GetMapping("/categories")
    public Result<List<KbCategoryVO>> listCategories() {
        return Result.ok(kbFacadeService.listCategories());
    }

    @PostMapping("/categories")
    @OperLog(module = "知识库", operation = "创建分类", recordParams = true)
    public Result<KbCategoryVO> createCategory(@Valid @RequestBody CategoryBody body) {
        return Result.ok(kbFacadeService.createCategory(
                body.name(), body.parentId(), body.enabled(), body.sort(), body.remark()));
    }

    @PutMapping("/categories/{id}")
    public Result<KbCategoryVO> updateCategory(@PathVariable Long id, @Valid @RequestBody CategoryUpdateBody body) {
        return Result.ok(kbFacadeService.updateCategory(
                id, body.name(), body.enabled(), body.sort(), body.remark(),
                kbFacadeService.loadCategoryBefore(id)));
    }

    @DeleteMapping("/categories/{id}")
    public Result<Void> deleteCategory(@PathVariable Long id) {
        kbFacadeService.deleteCategory(id, kbFacadeService.loadCategoryBefore(id));
        return Result.ok();
    }

    // ------------------------------------------------------------------ 分类节点管理员 / 移动（知识库域一期）

    /**
     * 管辖节点 id 列表（本人可管理的全部节点；列表页即需，权限码 {@code kb:category:list}）。
     */
    @GetMapping("/categories/manageable-ids")
    public Result<Set<Long>> manageableCategoryIds() {
        return Result.ok(kbFacadeService.listManageableCategoryIds());
    }

    /**
     * 移动分类节点（权限码 {@code kb:category:manage} + 兜底判权；目标须在管辖内且非自己后代）。
     */
    @PutMapping("/categories/{id}/move")
    public Result<KbCategoryVO> moveCategory(
            @PathVariable Long id, @Valid @RequestBody CategoryMoveBody body) {
        requireCategoryManagePermission();
        return Result.ok(kbFacadeService.moveCategory(id, body.newParentId(),
                kbFacadeService.loadCategoryBefore(id)));
    }

    /**
     * 分类节点管理员列表（权限码 {@code kb:category:manage} + 兜底判权）。
     */
    @GetMapping("/categories/{id}/admins")
    public Result<List<KbCategoryAdminVO>> listCategoryAdmins(@PathVariable Long id) {
        requireCategoryManagePermission();
        return Result.ok(kbFacadeService.listCategoryAdmins(id));
    }

    /**
     * 新增分类节点管理员（权限码 {@code kb:category:manage} + 兜底判权）。
     */
    @PostMapping("/categories/{id}/admins")
    public Result<KbCategoryAdminVO> grantCategoryAdmin(
            @PathVariable Long id, @Valid @RequestBody KbCategoryAdminCreateRequest body) {
        requireCategoryManagePermission();
        return Result.ok(kbFacadeService.grantCategoryAdmin(id, body.subjectType(), body.subjectId(),
                kbFacadeService.loadCategoryAdminListBefore(id)));
    }

    /**
     * 移除分类节点管理员（权限码 {@code kb:category:manage} + 兜底判权）。
     */
    @DeleteMapping("/category-admins/{adminId}")
    public Result<Void> revokeCategoryAdmin(@PathVariable Long adminId) {
        requireCategoryManagePermission();
        kbFacadeService.revokeCategoryAdmin(adminId, KbAuditBefore.minimal(adminId));
        return Result.ok();
    }

    // ------------------------------------------------------------------ 知识库

    @GetMapping("/libraries")
    public Result<List<KbLibraryVO>> listLibraries(
            @RequestParam(required = false) Long categoryId,
            @RequestParam(required = false) String scope) {
        return Result.ok(kbFacadeService.listLibraries(categoryId, scope));
    }

    @GetMapping("/libraries/{id}")
    public Result<KbLibraryVO> getLibrary(@PathVariable Long id) {
        return Result.ok(kbFacadeService.getLibrary(id));
    }

    @PostMapping("/libraries")
    @OperLog(module = "知识库", operation = "创建知识库", recordParams = true)
    public Result<KbLibraryVO> createLibrary(@Valid @RequestBody LibraryBody body) {
        return Result.ok(kbFacadeService.createLibrary(
                body.categoryId(), body.name(), body.secrecy(), body.owner(), body.settings()));
    }

    @PutMapping("/libraries/{id}")
    public Result<KbLibraryVO> updateLibrary(@PathVariable Long id, @Valid @RequestBody LibraryUpdateBody body) {
        return Result.ok(kbFacadeService.updateLibrary(
                id, body.name(), body.secrecy(), body.status(), body.settings(),
                kbFacadeService.loadLibraryBefore(id)));
    }

    /**
     * 删除知识库（T04：默认<b>归档</b>，不是物理删除；Q1 两段式确认流加 {@code force}）。
     *
     * <p>不带 {@code mode} 时下游执行「引擎侧 dataset 改名 + 本地 status=0」，
     * 引擎数据一条不删——回执 {@code message} 会把这件事写明，前端必须原样展示，
     * 不要在这层改写成「删除成功」，否则管理员会以为引擎侧空间已经释放。
     *
     * <p><b>Q1 {@code force}：</b>{@code force=false}（默认）时若引擎侧 dataset 已不存在，
     * mis-kb 返回提示态回执（{@code engineMissing=true}，本地零变更），前端警示并要求确认
     * 后以 {@code force=true} 重调。{@code @OperLog(recordParams=true)} 不变——
     * {@code force} 作为 {@code @RequestParam} 自动进入审计 {@code request_params}。
     *
     * @param id    知识库 id
     * @param mode  {@code archive}（默认）/ {@code physical}
     * @param force 是否跳过引擎直接本地执行（仅对 engineMissing 生效，默认 false）
     * @return 删除回执（含引擎同步结果、实际清理范围与 engineMissing）
     */
    @DeleteMapping("/libraries/{id}")
    @OperLog(module = "知识库", operation = "删除知识库", recordParams = true)
    public Result<KbLibraryDeleteResultVO> deleteLibrary(
            @PathVariable Long id,
            @RequestParam(required = false, defaultValue = "archive") String mode,
            @RequestParam(required = false, defaultValue = "false") boolean force) {
        return Result.ok(kbFacadeService.deleteLibrary(id, mode, force));
    }

    /**
     * 查看知识库的引擎引用（Q4 有限暴露 dataset_id）。
     *
     * <p><b>为什么必须打 {@code @OperLog}：</b>该端点会返回引擎侧 {@code dataset_id}——
     * 拿到它就能绕过 MIS 直连 RAGFLOW 操作数据，属于跨越架构边界的敏感信息。
     * 判权由 {@code kb:library:engine-ref:view} 在网关注册表侧完成，这里只负责留痕。
     *
     * @param id 知识库 id
     * @return 引擎引用视图
     */
    @GetMapping("/libraries/{id}/engine-ref")
    @OperLog(module = "知识库", operation = "查看引擎引用")
    public Result<KbEngineRefVO> getEngineRef(@PathVariable Long id) {
        return Result.ok(kbFacadeService.getEngineRef(id));
    }

    /** 知识库详情聚合（L-06），详情页三 Tab 首屏共用。 */
    @GetMapping("/libraries/{id}/detail")
    public Result<KbLibraryDetailVO> getLibraryDetail(@PathVariable Long id) {
        return Result.ok(kbFacadeService.getLibraryDetail(id));
    }

    /** 读取知识库 RAG 设置（L-08）。 */
    @GetMapping("/libraries/{id}/engine/settings")
    public Result<KbRagSettings> getRagSettings(@PathVariable Long id) {
        return Result.ok(kbFacadeService.getRagSettings(id));
    }

    /** 保存知识库 RAG 设置并同步引擎（L-08；KE-01 审计快照入参，before=旧设置）。 */
    @PutMapping("/libraries/{id}/engine/settings")
    public Result<KbRagSettings> updateRagSettings(
            @PathVariable Long id, @RequestBody KbRagSettings settings) {
        return Result.ok(kbFacadeService.updateRagSettings(id, settings,
                kbFacadeService.loadRagSettingsBefore(id)));
    }

    /**
     * 触发图谱构建（Wave B GraphRAG PoC，T02）。
     *
     * <p><b>构图 = 修改引擎侧资源，按「写」对待（设计 §2.5 红线）：</b>权限码
     * {@code kb:library:edit}（V31 注册 91123 → 91044）+ {@code @OperLog} 留痕；
     * mis-kb 侧 {@code KbGraphService.build} 还有 {@code hasLibraryManage} 管辖双闸门 +
     * 能力/上限/状态机校验（第二道防线）。
     *
     * <p>{@code requirePermission} 是注册表未生效空窗期的兜底判权（与
     * {@link #requireHitTestPermission()} 同款口径，读 {@link UserPermissionLoader#load}）。
     *
     * @param id 知识库 id
     * @return 构图触发回执
     */
    @PostMapping("/libraries/{id}/graph/build")
    @OperLog(module = "知识库", operation = "触发知识图谱构建", recordParams = true)
    public Result<KbGraphBuildResultVO> buildGraph(@PathVariable Long id) {
        requirePermission(PERM_LIBRARY_EDIT);
        return Result.ok(kbFacadeService.buildGraph(id));
    }

    /**
     * 查询图谱构建状态（Wave B GraphRAG PoC，T02；前端 3s 轮询）。
     *
     * <p><b>读操作默认不挂审计（U6 裁定）：</b>3s 轮询 × 多管理员 = 审计表噪声；
     * 权限码 {@code kb:library:engine-ref:view}（V31 注册 91124 → 91056）。
     *
     * @param id 知识库 id
     * @return 状态回执
     */
    @GetMapping("/libraries/{id}/graph/build-status")
    public Result<KbGraphStatusVO> graphBuildStatus(@PathVariable Long id) {
        requirePermission(PERM_LIBRARY_ENGINE_REF_VIEW);
        return Result.ok(kbFacadeService.graphBuildStatus(id));
    }

    /**
     * 触发 RAPTOR 摘要构建（Wave C RAPTOR，T02）。
     *
     * <p><b>构建 = 修改引擎侧资源，按「写」对待（设计 §2.5 红线同款）：</b>权限码
     * {@code kb:library:edit}（V34 注册 91155 → 91044）+ {@code @OperLog} 留痕；
     * mis-kb 侧 {@code KbRaptorService.build} 还有 {@code hasLibraryManage} 管辖双闸门 +
     * 能力/状态机校验（第二道防线）。<b>U4：无库数上限</b>——只有平台总开关
     * {@code mis.kb.engine.raptor-enabled} + 能力 {@code raptor} 闸门。
     * graph/raptor 构建<b>不互斥可并行</b>（T00 P2c 实测）。
     *
     * <p>{@code requirePermission} 是注册表未生效空窗期的兜底判权（与
     * {@link #requireHitTestPermission()} 同款口径，读 {@link UserPermissionLoader#load}）。
     *
     * @param id 知识库 id
     * @return 构建触发回执
     */
    @PostMapping("/libraries/{id}/raptor/build")
    @OperLog(module = "知识库", operation = "触发 RAPTOR 摘要构建", recordParams = true)
    public Result<KbRaptorBuildResultVO> buildRaptor(@PathVariable Long id) {
        requirePermission(PERM_LIBRARY_EDIT);
        return Result.ok(kbFacadeService.buildRaptor(id));
    }

    /**
     * 查询 RAPTOR 构建状态（Wave C RAPTOR，T02；前端 3s 轮询）。
     *
     * <p><b>读操作默认不挂审计（U6 裁定）：</b>3s 轮询 × 多管理员 = 审计表噪声；
     * 权限码 {@code kb:library:engine-ref:view}（V34 注册 91156 → 91056）。
     *
     * @param id 知识库 id
     * @return 状态回执
     */
    @GetMapping("/libraries/{id}/raptor/build-status")
    public Result<KbRaptorStatusVO> raptorBuildStatus(@PathVariable Long id) {
        requirePermission(PERM_LIBRARY_ENGINE_REF_VIEW);
        return Result.ok(kbFacadeService.raptorBuildStatus(id));
    }

    // ------------------------------------------------------------------ 文档

    @GetMapping("/libraries/{libraryId}/documents")
    public Result<List<KbDocumentVO>> listDocuments(@PathVariable Long libraryId) {
        return Result.ok(kbFacadeService.listDocuments(libraryId));
    }

    @GetMapping("/libraries/{libraryId}/documents/{id}")
    public Result<KbDocumentVO> getDocument(@PathVariable Long libraryId, @PathVariable Long id) {
        return Result.ok(kbFacadeService.getDocument(libraryId, id));
    }

    /**
     * 分页列举文档切片（「查看文档切分效果」）。
     *
     * <p>权限双闸门：① BFF 侧 {@code kb:document:list} 兜底判权（{@link #requirePermission}，
     * 注册表未生效空窗期）；② mis-kb 侧 {@code KbVisibilityService.hasPermission} ACL 读权限
     * 二次裁定。读操作但仍挂 {@code @OperLog} 留痕（切片原文属敏感内容，审计谁在什么时间
     * 查看了哪个文档的切分结果）。
     */
    @GetMapping("/libraries/{libraryId}/documents/{id}/chunks")
    @OperLog(module = "知识库", operation = "查看文档切分", recordParams = true)
    public Result<KbDocumentChunksVO> listDocumentChunks(
            @PathVariable Long libraryId,
            @PathVariable Long id,
            @RequestParam(required = false) String keywords,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "50") int pageSize) {
        requirePermission(PERM_DOCUMENT_LIST);
        return Result.ok(kbFacadeService.listDocumentChunks(libraryId, id, keywords, page, pageSize));
    }

    /**
     * 拉取分片版面截图（「查看切分」卡片配图；直吐 JPEG，不包 Result）。
     *
     * <p>权限与 listChunks 同口径：{@code kb:document:list}。imageId 为引擎侧
     * {@code {datasetId}-{objectId}}。
     */
    @GetMapping(
            value = "/libraries/{libraryId}/documents/{id}/chunk-images/{imageId}")
    public ResponseEntity<byte[]> getChunkImage(
            @PathVariable Long libraryId,
            @PathVariable Long id,
            @PathVariable String imageId) {
        requirePermission(PERM_DOCUMENT_LIST);
        byte[] bytes = kbFacadeService.getChunkImage(libraryId, id, imageId);
        MediaType mediaType = detectChunkImageMediaType(bytes);
        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=3600")
                .contentType(mediaType)
                .body(bytes);
    }

    private static MediaType detectChunkImageMediaType(byte[] bytes) {
        if (bytes != null && bytes.length >= 8
                && bytes[0] == (byte) 0x89 && bytes[1] == 'P' && bytes[2] == 'N' && bytes[3] == 'G') {
            return MediaType.IMAGE_PNG;
        }
        return MediaType.IMAGE_JPEG;
    }

    @PostMapping("/libraries/{libraryId}/documents")
    @OperLog(module = "知识库", operation = "上传文档", recordParams = true)
    public Result<KbDocumentUploadResponse> uploadDocument(
            @PathVariable Long libraryId,
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String chunkMethod,
            @RequestParam(required = false) Integer chunkTokenNum,
            @RequestParam(required = false) String separator,
            @RequestParam(required = false) Boolean pageIndex,
            @RequestParam(required = false) Integer imageTableContextWindow,
            @RequestParam(required = false) Integer autoKeywords,
            @RequestParam(required = false) Integer autoQuestions) {
        return Result.ok(kbFacadeService.uploadDocument(
                libraryId, file, chunkMethod, chunkTokenNum, separator,
                pageIndex, imageTableContextWindow, autoKeywords, autoQuestions));
    }

    /** 更新文档级切片配置（kb_settings_model_chunk；KE-01 审计快照入参，before=旧切片配置）。 */
    @PutMapping("/libraries/{libraryId}/documents/{id}/chunk-config")
    public Result<Void> updateDocumentChunkConfig(
            @PathVariable Long libraryId,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body) {
        kbFacadeService.updateDocumentChunkConfig(libraryId, id, body,
                kbFacadeService.loadDocumentBefore(libraryId, id));
        return Result.ok();
    }

    @PutMapping("/libraries/{libraryId}/documents/{id}/enable")
    public Result<Void> setDocumentEnabled(
            @PathVariable Long libraryId, @PathVariable Long id, @RequestParam boolean enabled) {
        kbFacadeService.setDocumentEnabled(libraryId, id, enabled,
                kbFacadeService.loadDocumentBefore(libraryId, id));
        return Result.ok();
    }

    @PostMapping("/libraries/{libraryId}/documents/{id}/reparse")
    @OperLog(module = "知识库", operation = "文档重解析", recordParams = true)
    public Result<Void> reparseDocument(@PathVariable Long libraryId, @PathVariable Long id) {
        kbFacadeService.reparseDocument(libraryId, id);
        return Result.ok();
    }

    /**
     * 库级一键全部重解析（P1-1；KE-05 扩展 {@code onlyFailed=true} 仅重试失败文档）。
     *
     * <p>返回结构化结果（成功/失败/跳过 + 失败明细）供前端反馈。
     *
     * @param libraryId  知识库 id
     * @param onlyFailed 仅重试 {@code parse_status=failed} 文档；缺省 false = 全量
     */
    @PostMapping("/libraries/{libraryId}/documents/reparse-all")
    @OperLog(module = "知识库", operation = "全部重解析", recordParams = true)
    public Result<KbReparseAllResultVO> reparseAllDocuments(
            @PathVariable Long libraryId,
            @RequestParam(defaultValue = "false") boolean onlyFailed) {
        return Result.ok(kbFacadeService.reparseAllDocuments(libraryId, onlyFailed));
    }

    @DeleteMapping("/libraries/{libraryId}/documents/{id}")
    public Result<Void> deleteDocument(@PathVariable Long libraryId, @PathVariable Long id) {
        kbFacadeService.deleteDocument(libraryId, id,
                kbFacadeService.loadDocumentBefore(libraryId, id));
        return Result.ok();
    }

    // ------------------------------------------------------------------ ACL

    @GetMapping("/libraries/{libraryId}/acls")
    public Result<List<KbAclVO>> listAcls(@PathVariable Long libraryId) {
        return Result.ok(kbFacadeService.listAcls(libraryId));
    }

    @PostMapping("/libraries/{libraryId}/acls")
    public Result<KbAclVO> grantAcl(@PathVariable Long libraryId, @Valid @RequestBody AclBody body) {
        return Result.ok(kbFacadeService.grantAcl(
                libraryId, body.subjectType(), body.subjectId(), body.action(),
                kbFacadeService.loadAclListBefore(libraryId)));
    }

    @DeleteMapping("/acls/{id}")
    public Result<Void> revokeAcl(@PathVariable Long id) {
        kbFacadeService.revokeAcl(id, KbAuditBefore.minimal(id));
        return Result.ok();
    }

    /**
     * KBP-10 存量 manage/acl 授权清单（运营清理依据，只读不清理）。
     *
     * <p><b>权限双闸门：</b>① BFF 侧 {@code kb:acl:revoke} 兜底判权（{@link #requirePermission}，
     * 与 {@code ApiPermissionInterceptor} + 注册表的主路径互补，覆盖注册表空窗期）；
     * ② mis-kb 侧 {@code isGlobalAdmin}（非全局管理员 40311，防普通分类管理员看到全平台授权数据）。
     *
     * @param libraryId   按库维度过滤；缺省 = 不限制
     * @param subjectType 按主体类型过滤；缺省 = 不限制
     * @param subjectId   按主体 id 过滤；缺省 = 不限制
     * @return 存量 manage/acl 授权清单（subjectName 已由门面回填）
     */
    @GetMapping("/acls/inventory")
    public Result<List<LegacyAclInventoryVO>> listLegacyAclInventory(
            @RequestParam(required = false) Long libraryId,
            @RequestParam(required = false) String subjectType,
            @RequestParam(required = false) Long subjectId) {
        requirePermission(PERM_ACL_REVOKE);
        return Result.ok(kbFacadeService.listLegacyAclInventory(libraryId, subjectType, subjectId));
    }

    // ------------------------------------------------------------------ 问答历史 / 反馈

    @GetMapping("/qa/sessions/mine")
    public Result<List<KbQaSessionVO>> listMySessions() {
        return Result.ok(kbFacadeService.listMySessions());
    }

    @GetMapping("/qa/sessions/{sessionId}")
    public Result<KbQaSessionDetailVO> getSessionDetail(@PathVariable Long sessionId) {
        return Result.ok(kbFacadeService.getSessionDetail(sessionId));
    }

    /** 删除我的问答会话（用户侧软删除，归属/幂等由 mis-kb 裁定；无额外权限码，沿用 kb:qa:ask）。 */
    @DeleteMapping("/qa/sessions/{sessionId}")
    @OperLog(module = "知识库", operation = "删除问答会话", recordParams = true)
    public Result<Void> deleteSession(@PathVariable Long sessionId) {
        kbFacadeService.deleteSession(sessionId);
        return Result.ok();
    }

    @PostMapping("/qa/feedback")
    @OperLog(module = "知识库", operation = "提交问答反馈", recordParams = true)
    public Result<KbQaFeedbackVO> submitFeedback(@Valid @RequestBody FeedbackBody body) {
        return Result.ok(kbFacadeService.submitFeedback(
                body.sessionId(), body.accuracy(), body.helpful(), body.offtopic(), body.citeError()));
    }

    @GetMapping("/qa/sessions/{sessionId}/feedback")
    public Result<KbQaFeedbackVO> getFeedback(@PathVariable Long sessionId) {
        return Result.ok(kbFacadeService.getFeedback(sessionId));
    }

    // ------------------------------------------------------------------ 运营（只读）

    /**
     * 运营问答列表（A-02b，带筛选分页 + 提问人姓名回填）。
     *
     * <p><b>破坏性变更提示：</b>P0 时本路径返回 {@code List<KbQaSessionVO>}，
     * 现返回 {@code PageResult<KbQaSessionListVO>}。P0 老页面请改用
     * {@link #listAllSessionsLegacy}，前端已同步改造。
     */
    @GetMapping("/operations/qa/sessions")
    public Result<PageResult<KbQaSessionListVO>> listOperationSessions(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) Long libraryId,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) Boolean hasFeedback,
            @RequestParam(required = false) String sentiment,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return Result.ok(kbFacadeService.listOperationSessions(
                from, to, libraryId, userId, hasFeedback, sentiment, keyword, page, size));
    }

    /** 运营问答详情（A-02a，含可见范围与召回参数）。 */
    @GetMapping("/operations/qa/sessions/{sessionId}")
    public Result<KbQaSessionDetailVO> getOperationSessionDetail(@PathVariable Long sessionId) {
        return Result.ok(kbFacadeService.getOperationSessionDetail(sessionId));
    }

    /** 运营：P0 全量会话列表（兼容保留）。 */
    @GetMapping("/operations/qa/sessions-all")
    public Result<List<KbQaSessionVO>> listAllSessionsLegacy() {
        return Result.ok(kbFacadeService.listAllSessions());
    }

    @GetMapping("/operations/qa/feedback")
    public Result<List<KbQaFeedbackVO>> listAllFeedback() {
        return Result.ok(kbFacadeService.listAllFeedback());
    }

    /** 评价看板（A-02b/d）。 */
    @GetMapping("/operations/stats")
    public Result<KbDashboardVO> stats(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        return Result.ok(kbFacadeService.stats(from, to));
    }

    /**
     * 运营记录 CSV 导出（A-02e）。
     *
     * <p>直接返回文件流而不是包在 {@code Result} 里：浏览器要的是可下载的字节，
     * 包一层 JSON 反而逼前端再解一次再造 Blob，纯属自找麻烦。
     *
     * @param desensitize 是否脱敏 userId，默认 true
     * @return CSV 文件响应
     */
    @GetMapping("/operations/qa/export")
    public ResponseEntity<ByteArrayResource> exportCsv(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) Long libraryId,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) Boolean hasFeedback,
            @RequestParam(required = false) String sentiment,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Boolean desensitize) {
        String csv = kbFacadeService.exportCsv(
                from, to, libraryId, userId, hasFeedback, sentiment, keyword, desensitize);
        byte[] bytes = csv.getBytes(StandardCharsets.UTF_8);
        String filename = kbFacadeService.exportFilename();
        String encoded = URLEncoder.encode(filename, StandardCharsets.UTF_8).replace("+", "%20");
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + filename + "\"; filename*=UTF-8''" + encoded)
                .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                .contentLength(bytes.length)
                .body(new ByteArrayResource(bytes));
    }

    // ------------------------------------------------------------------ 工单（F-10 / A-02c）

    /** 建工单（F-10 问答一键报错）。 */
    @PostMapping("/operations/qa/tickets")
    @OperLog(module = "知识库", operation = "创建问答工单", recordParams = true)
    public Result<KbQaTicketVO> createTicket(@Valid @RequestBody TicketBody body) {
        return Result.ok(kbFacadeService.createTicket(
                body.sessionId(), body.messageId(), body.type(), body.content()));
    }

    /** 工单列表（A-02c）。 */
    @GetMapping("/operations/qa/tickets")
    public Result<PageResult<KbQaTicketVO>> listTickets(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return Result.ok(kbFacadeService.listTickets(status, page, size));
    }

    /** 工单详情。 */
    @GetMapping("/operations/qa/tickets/{ticketId}")
    public Result<KbQaTicketVO> getTicket(@PathVariable Long ticketId) {
        return Result.ok(kbFacadeService.getTicket(ticketId));
    }

    /** 处理/关闭工单（A-02c）。 */
    @PatchMapping("/operations/qa/tickets/{ticketId}")
    @OperLog(module = "知识库", operation = "处理问答工单", recordParams = true)
    public Result<KbQaTicketVO> patchTicket(
            @PathVariable Long ticketId, @RequestBody TicketPatchBody body) {
        return Result.ok(kbFacadeService.patchTicket(
                ticketId, body.status(), body.note(), body.relAction(), body.processorId()));
    }

    /** 某会话下的工单列表（问答详情页侧栏）。 */
    @GetMapping("/operations/qa/tickets/by-session/{sessionId}")
    public Result<List<KbQaTicketVO>> listTicketsBySession(@PathVariable Long sessionId) {
        return Result.ok(kbFacadeService.listTicketsBySession(sessionId));
    }

    /**
     * 标记问答反馈已处理/忽略（OP-05）。
     *
     * <p>处理人取当前登录人（{@code X-User-Id}/{@code X-Username} 透传 mis-kb），
     * 状态机 pending → handled/ignored 单向终态，非法流转由 mis-kb 拒绝。
     *
     * <p>方法名与 {@link KbFacadeService#markFeedbackProcessed} 同名对齐——审计挂点契约
     * （KbControllerOperLogCoverageTest）要求 Controller 写方法在 KbFacadeService 存在
     * 同名门面方法且恰有一处 {@code @OperLog}；本方法挂 Controller 侧。
     */
    @PatchMapping("/operations/qa/feedback/{feedbackId}/process")
    @OperLog(module = "知识库", operation = "处理问答反馈", recordParams = true)
    public Result<KbQaFeedbackVO> markFeedbackProcessed(
            @PathVariable Long feedbackId, @RequestBody FeedbackProcessBody body) {
        return Result.ok(kbFacadeService.markFeedbackProcessed(
                feedbackId, body.status(), body.note()));
    }

    // ------------------------------------------------------------------ 授权主体（I-03）

    /**
     * 授权主体检索。
     *
     * @param type    主体类型 user/role/dept，缺省 user
     * @param keyword 关键字；dept 忽略
     * @return 主体列表（dept 为树形）
     */
    @GetMapping("/subjects/search")
    public Result<List<KbSubjectVO>> searchSubjects(
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String keyword) {
        return Result.ok(kbFacadeService.searchSubjects(type, keyword));
    }

    // ------------------------------------------------------------------ 命中测试（Q-04 / WA-07）

    /**
     * 命中测试（权限码 {@code kb:hittest:run}）。
     *
     * <p><b>API 级判权的当前客观状态（勿再写成既成事实）：</b>登记 SQL 已在
     * {@code V17__kb_hittest_perms.sql} 的 D 段就绪——{@code sys_api}(91060 catalog / 91061 api)
     * 加 {@code sys_menu_api} 关联到<b>页面菜单 91039</b>（permission = {@code kb:hittest:run}）。
     * 但它<b>生效有两个前提</b>：(1) 该迁移在目标库上真实执行成功；(2) BFF 侧
     * {@code ApiPermissionRegistry} 完成重载（重启，或等 {@code refresh-interval-seconds}
     * 默认 300s 到期）。两者任一未满足，{@code ApiPermissionInterceptor} 就查不到映射，
     * 而 BFF 配的是 {@code deny-unmapped: false}（未映射即放行）——此时本端点等同
     * 「登录即可调用」。截至本次提交，上述迁移<b>尚未在任何环境实测执行过</b>。
     *
     * <p>正因为存在这个空窗，本方法内另有一道
     * {@link #requireHitTestPermission()} 兜底判权，见该方法注释。
     *
     * <p><b>为什么权限码之外还要服务端 ACL：</b>{@code kb:hittest:run} 回答的是
     * 「这个人能不能用命中测试这个功能」，{@code hasPermission(userId, libraryId, READ)}
     * 回答的是「这个人能不能读这个库」。两个问题，两道闸门，缺一不可——
     * 只有前者会让有权用功能的人探到无权看的库，只有后者会让任何有库读权限的人
     * 绕开菜单直接调接口。
     *
     * <p><b>为什么必须打 {@code @OperLog}：</b>命中测试能读到<b>跨密级知识库的 chunk 原文</b>，
     * 实质是一次内容读取。导出（WA-15）不记审计是因为导出的内容用户在页面上本就看得见，
     * 但「谁在什么时候用什么问题探过哪个库」这件事本身必须留痕，否则是合规缺口。
     *
     * <p><b>{@code recordParams = true}（T19）：</b>只记「调用了命中测试」而不记探的是哪个库、
     * 用的什么问题，审计价值接近于零——追责时无从还原现场。切面会采集脱敏截断后的入参
     * 与命中条数写入 {@code request_params}。question 属<b>追责证据</b>，故只截断不脱敏；
     * 凭据类字段由切面黑名单（C5-2）在源头屏蔽。
     *
     * @param body 命中测试请求
     * @return 命中结果 + 生效参数 + 耗时
     */
    @PostMapping("/hit-test")
    @OperLog(module = "知识库", operation = "命中测试", recordParams = true)
    public Result<KbHitTestResultVO> hitTest(@Valid @RequestBody KbHitTestRequest body) {
        requireHitTestPermission();
        return Result.ok(kbFacadeService.hitTest(body));
    }

    /**
     * 命中测试的兜底判权。
     *
     * <p><b>与 {@code ApiPermissionInterceptor} 判权的关系：兜底，不是替代。</b>
     * 主路径仍然是拦截器 + {@code sys_api} 注册表；本方法只覆盖「V17 尚未执行成功、
     * 或注册表尚未重载」这段空窗期。两者都生效时，拦截器先在 {@code preHandle} 拒绝，
     * 本方法根本不会被执行到，无重复代价。
     *
     * <p><b>为什么读 {@link UserPermissionLoader} 而不是 {@code LoginUser.getPermissions()}：</b>
     * {@code LoginUser.permissions} 初值是 {@code Collections.emptySet()}，全仓唯一的
     * {@code setPermissions} 调用点在 {@code ApiPermissionInterceptor:80}，而那行位于
     * 「路径已映射且非 authOnly」分支之后。也就是说，恰恰在本方法需要兜底的场景
     * （路径未映射 → 拦截器第 57 行提前 {@code return true}）下，该字段<b>恒为空集</b>。
     * 若照读该字段判权，结果是对所有人 403 —— fail-close 事故。故必须复用
     * 拦截器同款的真实权限查询路径 {@code UserPermissionLoader.load(LoginUser)}
     * （Redis 命中即返回，miss 才回源 mis-iam）。
     *
     * <p>拦截器已跑过的情况下，{@code load()} 第 46-48 行直接返回已填充的
     * {@code user.getPermissions()}，不产生额外 I/O。
     *
     * <p><b>顺带满足设计文档 C5-5：</b>拦截器在 {@code preHandle} 抛 403 时
     * {@code @OperLog} 切面尚未进入，越权调用不会留痕；由本方法抛出时，切面已在栈上，
     * 会如实记录一行 {@code responseCode=1} 的审计。
     *
     * @throws BusinessException 未登录时 {@code UNAUTHORIZED}；缺权限码时 {@code FORBIDDEN}
     */
    private void requireHitTestPermission() {
        LoginUser user = RequestContext.requireLoginUser();
        if (user.getUserId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        Set<String> permissions = userPermissionLoader.load(user);
        if (permissions == null || !permissions.contains(PERM_HIT_TEST_RUN)) {
            throw new BusinessException(ResultCode.FORBIDDEN);
        }
    }

    /**
     * 分类管理功能的兜底判权（知识库域一期，双闸门：主路径 {@code ApiPermissionInterceptor}
     * + sys_api 注册表；本方法只覆盖注册表尚未生效的空窗期）。
     *
     * <p>与 {@link #requireHitTestPermission()} 同款：读 {@link UserPermissionLoader#load(LoginUser)}
     * 而非 {@code LoginUser.getPermissions()}（后者在未映射路径下恒为空集，照读会 fail-close 事故）。
     *
     * @throws BusinessException 未登录时 {@code UNAUTHORIZED}；缺 {@code kb:category:manage} 时 {@code FORBIDDEN}
     */
    private void requireCategoryManagePermission() {
        LoginUser user = RequestContext.requireLoginUser();
        if (user.getUserId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        Set<String> permissions = userPermissionLoader.load(user);
        if (permissions == null || !permissions.contains(PERM_CATEGORY_MANAGE)) {
            throw new BusinessException(ResultCode.FORBIDDEN);
        }
    }

    /**
     * 按权限码兜底判权（Wave B GraphRAG PoC，T02；与 {@link #requireCategoryManagePermission()} 同款口径）。
     *
     * <p>主路径是 {@code ApiPermissionInterceptor} + {@code sys_api} 注册表（V31 已登记）；
     * 本方法只覆盖「注册表尚未生效」的空窗期，读 {@link UserPermissionLoader#load(LoginUser)}
     * 而非 {@code LoginUser.getPermissions()}（后者在未映射路径下恒为空集，照读会 fail-close 事故）。
     *
     * @param permissionCode 权限码（如 {@code kb:library:edit}）
     * @throws BusinessException 未登录时 {@code UNAUTHORIZED}；缺权限码时 {@code FORBIDDEN}
     */
    private void requirePermission(String permissionCode) {
        LoginUser user = RequestContext.requireLoginUser();
        if (user.getUserId() == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        Set<String> permissions = userPermissionLoader.load(user);
        if (permissions == null || !permissions.contains(permissionCode)) {
            throw new BusinessException(ResultCode.FORBIDDEN);
        }
    }

    // ------------------------------------------------------------------ 引擎（S-04）

    @GetMapping("/engine/health")
    public Result<KbEngineHealthVO> engineHealth() {
        return Result.ok(kbFacadeService.engineHealth());
    }

    @GetMapping("/engine/capabilities")
    public Result<KbEngineCapabilitiesVO> engineCapabilities() {
        return Result.ok(kbFacadeService.engineCapabilities());
    }

    @GetMapping("/engine/models")
    public Result<KbEngineModelPoolVO> engineModels() {
        return Result.ok(kbFacadeService.listEngineModels());
    }

    /**
     * 读取最近一次引擎对账报告（T04）。
     *
     * <p>只读缓存，不触发引擎调用，因此<b>不</b>记审计——它读到的信息（库名、同步状态）
     * 在知识库列表页本就可见，没有额外的信息暴露面。
     *
     * @return 对账报告
     */
    @GetMapping("/engine/reconcile")
    public Result<KbEngineReconcileVO> engineReconcileReport() {
        return Result.ok(kbFacadeService.engineReconcileReport());
    }

    /**
     * 手动触发一次引擎对账（T04）。
     *
     * <p>会真实打引擎的 list datasets 接口并写 {@code kb_engine_orphan}，属于写操作，
     * 所以要留痕；判权由 {@code kb:engine:reconcile} 在网关注册表侧完成。
     *
     * @return 本次对账报告
     */
    @PostMapping("/engine/reconcile")
    @OperLog(module = "知识库", operation = "触发引擎对账", recordParams = true)
    public Result<KbEngineReconcileVO> runEngineReconcile() {
        return Result.ok(kbFacadeService.runEngineReconcile());
    }

    /**
     * 列出引擎侧游离 dataset（P1-T3）。
     *
     * <p>只读列表，<b>复用</b> P0 的 {@code kb:engine:reconcile} 权限码（与对账同源、风险同级），
     * 不另开权限码、不记审计（读的还是列表页本就可见的信息）。
     *
     * @param engineType 引擎类型；缺省取当前引擎
     * @param resolved   0=待处理（默认）1=已处置
     * @return 游离项列表
     */
    @GetMapping("/engine/orphans")
    public Result<List<KbEngineOrphanVO>> listEngineOrphans(
            @RequestParam(required = false) String engineType,
            @RequestParam(defaultValue = "0") int resolved) {
        return Result.ok(kbFacadeService.listEngineOrphans(engineType, resolved));
    }

    /**
     * 处置一个游离 dataset（P1-T3）。
     *
     * <p>写操作，受 {@code kb:engine:orphan:handle} 权限码保护，需留痕。
     *
     * @param engineType 引擎类型；缺省取当前引擎
     * @param nativeId   引擎原生 dataset id
     * @param body       处置请求
     * @return 处置结果（含引擎侧改名是否失败）
     */
    @PostMapping("/engine/orphans/{nativeId}/resolve")
    @OperLog(module = "知识库", operation = "处置游离数据集", recordParams = true)
    public Result<KbEngineOrphanResolveResultVO> resolveEngineOrphan(
            @RequestParam(required = false) String engineType,
            @PathVariable("nativeId") String nativeId,
            @Valid @RequestBody KbEngineOrphanResolveRequest body) {
        return Result.ok(kbFacadeService.resolveEngineOrphan(engineType, nativeId, body));
    }

    /**
     * 存量 dataset 批量重命名（P1-T4，方案 X：受控端点）。
     *
     * <p>高危批量改引擎名，权限码 {@code kb:engine:dataset:rename}，需留痕。
     * 默认 {@code dryRun=true} 只出计划；执行需 {@code confirmToken="RENAME-LEGACY"}，
     * 不带令牌由后端拒（mis-kb 侧 {@code KB_ENGINE_RENAME_CONFIRM_REQUIRED}）。
     *
     * @param body 请求（dryRun / confirmToken / limit）
     * @return 本次结果（含 batchId，供回滚定位）
     */
    @PostMapping("/engine/datasets/rename")
    @OperLog(module = "知识库", operation = "存量数据集改名", recordParams = true)
    public Result<KbEngineRenameResultVO> renameDatasets(@Valid @RequestBody KbEngineRenameReq body) {
        return Result.ok(kbFacadeService.renameDatasets(body));
    }

    /**
     * 回滚某批次的重命名（P1-T4）。
     *
     * @param body 请求（batchId）
     * @return 回滚结果
     */
    @PostMapping("/engine/datasets/rename/rollback")
    @OperLog(module = "知识库", operation = "存量数据集改名回滚", recordParams = true)
    public Result<KbEngineRenameResultVO> rollbackRenameDatasets(
            @Valid @RequestBody KbEngineRenameRollbackRequest body) {
        return Result.ok(kbFacadeService.rollbackRenameDatasets(body.batchId()));
    }

    /**
     * 最近的重命名日志（P1-T4）。
     *
     * @param limit 返回条数（默认 100）
     * @return 日志视图列表
     */
    @GetMapping("/engine/datasets/rename/logs")
    public Result<List<KbEngineRenameLogVO>> listRenameLogs(
            @RequestParam(defaultValue = "100") int limit) {
        return Result.ok(kbFacadeService.listRenameLogs(limit));
    }

    /**
     * 某批次的重命名日志（P1-T4）。
     *
     * @param batchId 批次号
     * @return 该批次日志视图列表
     */
    @GetMapping("/engine/datasets/rename/logs/{batchId}")
    public Result<List<KbEngineRenameLogVO>> getRenameLogsByBatch(
            @PathVariable("batchId") String batchId) {
        return Result.ok(kbFacadeService.getRenameLogsByBatch(batchId));
    }

    // ------------------------------------------------------------------ 请求体

    public record CategoryBody(
            @NotBlank String name,
            Long parentId,
            @NotNull Integer enabled,
            Integer sort,
            String remark) {
    }

    public record CategoryUpdateBody(
            @NotBlank String name,
            @NotNull Integer enabled,
            Integer sort,
            String remark) {
    }

    public record LibraryBody(
            @NotNull Long categoryId,
            @NotBlank String name,
            @NotBlank String secrecy,
            Long owner,
            KbRagSettings settings) {
    }

    public record LibraryUpdateBody(
            @NotBlank String name,
            @NotBlank String secrecy,
            Integer status,
            KbRagSettings settings) {
    }

    public record AclBody(
            @NotNull Long subjectId,
            @NotBlank String subjectType,
            @NotBlank String action) {
    }

    public record FeedbackBody(
            @NotNull Long sessionId,
            Integer accuracy,
            Integer helpful,
            Integer offtopic,
            Integer citeError) {
    }

    /**
     * 建工单请求体（F-10）。
     *
     * @param sessionId 关联会话 id
     * @param messageId 关联消息 id；可空
     * @param type      工单类型 answer_error/cite_error/missing_doc/permission/other
     * @param content   问题描述
     */
    public record TicketBody(
            @NotNull Long sessionId,
            Long messageId,
            @NotBlank String type,
            @NotBlank String content) {
    }

    /** 移动分类节点请求体（知识库域一期；newParentId 为空 = 移为根）。 */
    public record CategoryMoveBody(Long newParentId) {
    }

    /**
     * 工单处理请求体（A-02c）。
     *
     * <p>全部可空——PATCH 语义下「没传」和「传了空」必须能区分开。
     *
     * @param status      目标状态
     * @param note        处理备注
     * @param relAction   关联动作
     * @param processorId 处理人；不传则用当前登录人
     */
    public record TicketPatchBody(
            String status,
            String note,
            String relAction,
            Long processorId) {
    }

    /**
     * 反馈处理请求体（OP-05）。
     *
     * @param status 目标状态：handled 已处理 / ignored 已忽略；pending → handled/ignored 单向终态
     * @param note   处理备注；可空
     */
    public record FeedbackProcessBody(
            @NotBlank String status,
            String note) {
    }
}
