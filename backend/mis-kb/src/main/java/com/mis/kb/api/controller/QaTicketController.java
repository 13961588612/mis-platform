package com.mis.kb.api.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import com.mis.kb.api.dto.KbQaTicketVO;
import com.mis.kb.api.dto.TicketCreateRequest;
import com.mis.kb.api.dto.TicketPatchRequest;
import com.mis.kb.domain.service.KbQaTicketService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 问答工单端点（F-10 建单 + A-02c 运营处理）。
 *
 * <p><b>路径归属说明：</b>建单动作（POST）来自终端用户的问答页，语义上不属于「运营」，
 * 但设计文档把整组工单端点收在 {@code /operations/qa/tickets} 下以保持资源聚合。
 * 这里遵循设计文档，权限分级由 BFF 侧的按钮码 + 网关鉴权承担：
 * BFF 对 POST 只要求登录态，对 GET/PATCH 要求运营按钮码。
 */
@RestController
@RequestMapping("/internal/v1/kb/operations/qa/tickets")
public class QaTicketController {

    private final KbQaTicketService ticketService;

    public QaTicketController(KbQaTicketService ticketService) {
        this.ticketService = ticketService;
    }

    /**
     * 建工单（F-10 问答一键报错）。
     *
     * @param request 建单请求
     * @return 新建工单
     */
    @PostMapping
    public Result<KbQaTicketVO> create(@Valid @RequestBody TicketCreateRequest request) {
        return Result.ok(ticketService.create(request, currentUserId()));
    }

    /**
     * 工单分页列表（A-02c）。
     *
     * @param status 状态筛选（open/processing/resolved/closed）；可空
     * @param page   页码，从 1 开始
     * @param size   每页条数
     * @return 分页工单列表
     */
    @GetMapping
    public Result<PageResult<KbQaTicketVO>> list(
            @RequestParam(required = false) String status,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        return Result.ok(ticketService.list(status, page, size));
    }

    /**
     * 工单详情。
     *
     * @param ticketId 工单 id
     * @return 工单详情
     */
    @GetMapping("/{ticketId}")
    public Result<KbQaTicketVO> get(@PathVariable Long ticketId) {
        return Result.ok(ticketService.get(ticketId));
    }

    /**
     * 处理/关闭工单（A-02c）。
     *
     * <p>PATCH 语义：只更新请求体中显式出现的字段，未传字段保持原值。
     *
     * @param ticketId 工单 id
     * @param request  处理请求
     * @return 更新后的工单
     */
    @PatchMapping("/{ticketId}")
    public Result<KbQaTicketVO> patch(
            @PathVariable Long ticketId,
            @RequestBody TicketPatchRequest request) {
        return Result.ok(ticketService.patch(ticketId, request, currentUserId()));
    }

    /**
     * 某会话下的工单列表（问答详情页侧栏）。
     *
     * @param sessionId 会话 id
     * @return 工单列表，按 id 倒序
     */
    @GetMapping("/by-session/{sessionId}")
    public Result<List<KbQaTicketVO>> listBySession(@PathVariable Long sessionId) {
        return Result.ok(ticketService.listBySession(sessionId));
    }

    private Long currentUserId() {
        return SecurityContextHolder.getOptional().map(LoginUser::getUserId).orElse(null);
    }
}
