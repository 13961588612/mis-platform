package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.HitTestRequest;
import com.mis.kb.api.dto.HitTestResultVO;
import com.mis.kb.api.dto.QaCitationBatchRequest;
import com.mis.kb.api.dto.QaMessageCreateRequest;
import com.mis.kb.api.dto.QaMessageCreateResponse;
import com.mis.kb.api.dto.QaSessionCreateRequest;
import com.mis.kb.api.dto.QaSessionCreateResponse;
import com.mis.kb.api.dto.ResolveVisibleResponse;
import com.mis.kb.api.dto.RetrieveHitsVO;
import com.mis.kb.api.dto.RetrieveRequest;
import com.mis.kb.domain.service.KbHitTestService;
import com.mis.kb.domain.service.KbQaService;
import com.mis.kb.domain.service.KbRetrieveService;
import com.mis.kb.domain.service.KbVisibilityService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 问答/检索内部端点（mis-rag 调用）。
 *
 * <p>路径前缀 {@code /internal/v1/kb/rag}（可见库解析、检索）与 {@code /internal/v1/kb/qa}
 * （会话/消息/引用落库）。全部仅对内部服务放开，由 Gateway 限制来源。
 */
@RestController
@RequestMapping("/internal/v1/kb")
public class QaInternalController {

    private final KbVisibilityService visibilityService;
    private final KbRetrieveService retrieveService;
    private final KbQaService qaService;
    private final KbHitTestService hitTestService;

    public QaInternalController(
            KbVisibilityService visibilityService,
            KbRetrieveService retrieveService,
            KbQaService qaService,
            KbHitTestService hitTestService) {
        this.visibilityService = visibilityService;
        this.retrieveService = retrieveService;
        this.qaService = qaService;
        this.hitTestService = hitTestService;
    }

    /**
     * 解析用户可见知识库 id 列表（供 mis-rag 编排检索范围）。
     *
     * <p>{@code userId}/{@code tenantId} 为空时回退到 {@code X-User-Id}/{@code X-Tenant-Id} 透传头，
     * 便于 mis-rag 以服务身份代查指定用户的可见范围。
     */
    @GetMapping("/rag/resolve-visible")
    public Result<ResolveVisibleResponse> resolveVisible(
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) Long tenantId) {
        Long effectiveUserId = userId != null ? userId : currentUserId();
        Long effectiveTenantId = tenantId != null ? tenantId : currentTenantId();
        return Result.ok(new ResolveVisibleResponse(
                visibilityService.resolveVisibleLibraryIds(effectiveUserId, effectiveTenantId)));
    }

    /** 在可见库范围内检索，返回统一 ChunkHit（仅含 MIS 业务 ID）。 */
    @PostMapping("/rag/retrieve")
    public Result<RetrieveHitsVO> retrieve(
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) Long tenantId,
            @Valid @RequestBody RetrieveRequest request) {
        Long effectiveUserId = userId != null ? userId : currentUserId();
        Long effectiveTenantId = tenantId != null ? tenantId : currentTenantId();
        return Result.ok(retrieveService.retrieve(effectiveUserId, effectiveTenantId, request));
    }

    /**
     * 命中测试（Q-04 / WA-07）。
     *
     * <p>单库检索工具，<b>不写任何问答记录</b>。用户身份一律取 {@code X-User-Id}
     * 解析出的当前登录人，<b>不接受</b>请求体传 userId——否则前端随手改个 id
     * 就能越权读别人有权限的库。ACL 由 {@link KbHitTestService} 强制校验。
     *
     * <p>对外权限码 {@code kb:hittest:run} 由 BFF 侧
     * {@code POST /api/v1/kb/hit-test} 拦截，本内部端点只认服务间调用。
     *
     * @param request 命中测试请求
     * @return 命中结果 + 生效参数 + 耗时
     */
    @PostMapping("/hit-test")
    public Result<HitTestResultVO> hitTest(@Valid @RequestBody HitTestRequest request) {
        return Result.ok(hitTestService.run(request, currentUserId()));
    }

    /**
     * 创建问答会话。
     *
     * <p>会话归属以 {@code X-User-Id} 透传头解析出的实际用户为准（见
     * {@link KbQaService#createSession(QaSessionCreateRequest, Long)}）。
     */
    @PostMapping("/qa/sessions")
    public Result<QaSessionCreateResponse> createSession(@Valid @RequestBody QaSessionCreateRequest request) {
        Long sessionId = qaService.createSession(request, currentUserId());
        return Result.ok(new QaSessionCreateResponse(sessionId));
    }

    /**
     * 追加问答消息。
     *
     * <p>续聊场景下 {@code sessionId} 由前端透传，故须校验会话归属，防止跨用户注入。
     */
    @PostMapping("/qa/messages")
    public Result<QaMessageCreateResponse> appendMessage(@Valid @RequestBody QaMessageCreateRequest request) {
        Long messageId = qaService.appendMessage(request, currentUserId());
        return Result.ok(new QaMessageCreateResponse(messageId));
    }

    /** 批量落库引用（同样校验目标消息所属会话的归属）。 */
    @PostMapping("/qa/citations/batch")
    public Result<Integer> saveCitations(@Valid @RequestBody QaCitationBatchRequest request) {
        return Result.ok(qaService.saveCitations(request, currentUserId()));
    }

    private Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }

    private Long currentTenantId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getTenantId).orElse(null);
    }
}
