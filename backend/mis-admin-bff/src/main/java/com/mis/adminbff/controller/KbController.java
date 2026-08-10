package com.mis.adminbff.controller;

import com.mis.adminbff.dto.kb.KbAclVO;
import com.mis.adminbff.dto.kb.KbCategoryAdminCreateRequest;
import com.mis.adminbff.dto.kb.KbCategoryAdminVO;
import com.mis.adminbff.dto.kb.KbCategoryVO;
import com.mis.adminbff.dto.kb.KbDashboardVO;
import com.mis.adminbff.dto.kb.KbDocumentUploadResponse;
import com.mis.adminbff.dto.kb.KbDocumentVO;
import com.mis.adminbff.dto.kb.KbEngineCapabilitiesVO;
import com.mis.adminbff.dto.kb.KbEngineHealthVO;
import com.mis.adminbff.dto.kb.KbEngineModelPoolVO;
import com.mis.adminbff.dto.kb.KbHitTestRequest;
import com.mis.adminbff.dto.kb.KbHitTestResultVO;
import com.mis.adminbff.dto.kb.KbLibraryDetailVO;
import com.mis.adminbff.dto.kb.KbLibraryVO;
import com.mis.adminbff.dto.kb.KbQaFeedbackVO;
import com.mis.adminbff.dto.kb.KbQaSessionDetailVO;
import com.mis.adminbff.dto.kb.KbQaSessionListVO;
import com.mis.adminbff.dto.kb.KbQaSessionVO;
import com.mis.adminbff.dto.kb.KbQaTicketVO;
import com.mis.adminbff.dto.kb.KbRagSettings;
import com.mis.adminbff.dto.kb.KbReparseAllResultVO;
import com.mis.adminbff.dto.kb.KbSubjectVO;
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
    public Result<KbCategoryVO> createCategory(@Valid @RequestBody CategoryBody body) {
        return Result.ok(kbFacadeService.createCategory(
                body.name(), body.parentId(), body.enabled(), body.sort(), body.remark()));
    }

    @PutMapping("/categories/{id}")
    public Result<KbCategoryVO> updateCategory(@PathVariable Long id, @Valid @RequestBody CategoryUpdateBody body) {
        return Result.ok(kbFacadeService.updateCategory(
                id, body.name(), body.enabled(), body.sort(), body.remark()));
    }

    @DeleteMapping("/categories/{id}")
    public Result<Void> deleteCategory(@PathVariable Long id) {
        kbFacadeService.deleteCategory(id);
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
        return Result.ok(kbFacadeService.moveCategory(id, body.newParentId()));
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
        return Result.ok(kbFacadeService.grantCategoryAdmin(id, body.subjectType(), body.subjectId()));
    }

    /**
     * 移除分类节点管理员（权限码 {@code kb:category:manage} + 兜底判权）。
     */
    @DeleteMapping("/category-admins/{adminId}")
    public Result<Void> revokeCategoryAdmin(@PathVariable Long adminId) {
        requireCategoryManagePermission();
        kbFacadeService.revokeCategoryAdmin(adminId);
        return Result.ok();
    }

    // ------------------------------------------------------------------ 知识库

    @GetMapping("/libraries")
    public Result<List<KbLibraryVO>> listLibraries(@RequestParam(required = false) Long categoryId) {
        return Result.ok(kbFacadeService.listLibraries(categoryId));
    }

    @GetMapping("/libraries/{id}")
    public Result<KbLibraryVO> getLibrary(@PathVariable Long id) {
        return Result.ok(kbFacadeService.getLibrary(id));
    }

    @PostMapping("/libraries")
    public Result<KbLibraryVO> createLibrary(@Valid @RequestBody LibraryBody body) {
        return Result.ok(kbFacadeService.createLibrary(
                body.categoryId(), body.name(), body.secrecy(), body.owner(), body.settings()));
    }

    @PutMapping("/libraries/{id}")
    public Result<KbLibraryVO> updateLibrary(@PathVariable Long id, @Valid @RequestBody LibraryUpdateBody body) {
        return Result.ok(kbFacadeService.updateLibrary(
                id, body.name(), body.secrecy(), body.status(), body.settings()));
    }

    @DeleteMapping("/libraries/{id}")
    public Result<Void> deleteLibrary(@PathVariable Long id) {
        kbFacadeService.deleteLibrary(id);
        return Result.ok();
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

    /** 保存知识库 RAG 设置并同步引擎（L-08）。 */
    @PutMapping("/libraries/{id}/engine/settings")
    public Result<KbRagSettings> updateRagSettings(
            @PathVariable Long id, @RequestBody KbRagSettings settings) {
        return Result.ok(kbFacadeService.updateRagSettings(id, settings));
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

    @PostMapping("/libraries/{libraryId}/documents")
    public Result<KbDocumentUploadResponse> uploadDocument(
            @PathVariable Long libraryId,
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String chunkMethod,
            @RequestParam(required = false) Integer chunkTokenNum,
            @RequestParam(required = false) String separator) {
        return Result.ok(kbFacadeService.uploadDocument(
                libraryId, file, chunkMethod, chunkTokenNum, separator));
    }

    /** 更新文档级切片配置（kb_settings_model_chunk；改参触发重解析）。 */
    @PutMapping("/libraries/{libraryId}/documents/{id}/chunk-config")
    public Result<Void> updateDocumentChunkConfig(
            @PathVariable Long libraryId,
            @PathVariable Long id,
            @RequestBody Map<String, Object> body) {
        kbFacadeService.updateDocumentChunkConfig(libraryId, id, body);
        return Result.ok();
    }

    @PutMapping("/libraries/{libraryId}/documents/{id}/enable")
    public Result<Void> setDocumentEnabled(
            @PathVariable Long libraryId, @PathVariable Long id, @RequestParam boolean enabled) {
        kbFacadeService.setDocumentEnabled(libraryId, id, enabled);
        return Result.ok();
    }

    @PostMapping("/libraries/{libraryId}/documents/{id}/reparse")
    public Result<Void> reparseDocument(@PathVariable Long libraryId, @PathVariable Long id) {
        kbFacadeService.reparseDocument(libraryId, id);
        return Result.ok();
    }

    /**
     * 库级一键全部重解析（P1-1：换嵌入模型后全量重解析恢复检索）。
     *
     * <p>返回结构化结果（成功/失败/跳过 + 失败明细）供前端反馈。
     */
    @PostMapping("/libraries/{libraryId}/documents/reparse-all")
    public Result<KbReparseAllResultVO> reparseAllDocuments(@PathVariable Long libraryId) {
        return Result.ok(kbFacadeService.reparseAllDocuments(libraryId));
    }

    @DeleteMapping("/libraries/{libraryId}/documents/{id}")
    public Result<Void> deleteDocument(@PathVariable Long libraryId, @PathVariable Long id) {
        kbFacadeService.deleteDocument(libraryId, id);
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
                libraryId, body.subjectType(), body.subjectId(), body.action()));
    }

    @DeleteMapping("/acls/{id}")
    public Result<Void> revokeAcl(@PathVariable Long id) {
        kbFacadeService.revokeAcl(id);
        return Result.ok();
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

    @PostMapping("/qa/feedback")
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
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return Result.ok(kbFacadeService.listOperationSessions(
                from, to, libraryId, userId, hasFeedback, keyword, page, size));
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
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Boolean desensitize) {
        String csv = kbFacadeService.exportCsv(
                from, to, libraryId, userId, hasFeedback, keyword, desensitize);
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
}
