package com.mis.kb.api.controller;

import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.KbQaFeedbackVO;
import com.mis.kb.api.dto.KbQaSessionDetailVO;
import com.mis.kb.api.dto.KbQaSessionVO;
import com.mis.kb.api.dto.QaFeedbackRequest;
import com.mis.kb.domain.service.KbQaService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 问答历史与反馈端点（BFF 聚合调用，代表最终用户）。
 *
 * <p>与 {@link QaInternalController} 的区别：本控制器一律以<b>当前登录用户</b>为主体做归属校验，
 * 不允许跨用户读取他人会话；运营视角的全量读取走 {@code /operations/**}。
 */
@RestController
@RequestMapping("/internal/v1/kb/qa")
public class QaController {

    private final KbQaService qaService;

    public QaController(KbQaService qaService) {
        this.qaService = qaService;
    }

    /** 我的问答历史列表。 */
    @GetMapping("/sessions/mine")
    public Result<List<KbQaSessionVO>> listMySessions() {
        return Result.ok(qaService.listMySessions(currentUserId()));
    }

    /** 会话详情（含消息、引用、反馈）；跨用户访问按“不存在”处理。 */
    @GetMapping("/sessions/{sessionId}")
    public Result<KbQaSessionDetailVO> getSessionDetail(@PathVariable Long sessionId) {
        return Result.ok(qaService.getSessionDetail(sessionId, currentUserId()));
    }

    /** 删除我的问答会话（软删除：仅用户侧不可见，运营侧保留全量；重复删幂等成功）。 */
    @DeleteMapping("/sessions/{sessionId}")
    public Result<Void> deleteSession(@PathVariable Long sessionId) {
        qaService.deleteSession(sessionId, currentUserId());
        return Result.ok(null);
    }

    /** 提交/修改问答反馈（editable_once 语义：最多修改一次）。 */
    @PostMapping("/feedback")
    public Result<KbQaFeedbackVO> submitFeedback(@Valid @RequestBody QaFeedbackRequest request) {
        return Result.ok(qaService.submitFeedback(request, currentUserId()));
    }

    /** 查询某会话的反馈；未提交返回 data=null。 */
    @GetMapping("/sessions/{sessionId}/feedback")
    public Result<KbQaFeedbackVO> getFeedback(@PathVariable Long sessionId) {
        // 先做归属校验，避免越权读取他人反馈
        qaService.getSessionDetail(sessionId, currentUserId());
        return Result.ok(qaService.getFeedback(sessionId));
    }

    private Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }
}
