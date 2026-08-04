package com.mis.kb.api.controller;

import com.mis.common.core.result.PageResult;
import com.mis.common.core.result.Result;
import com.mis.kb.api.dto.KbDashboardVO;
import com.mis.kb.api.dto.KbQaExportRow;
import com.mis.kb.api.dto.KbQaFeedbackVO;
import com.mis.kb.api.dto.KbQaSessionDetailVO;
import com.mis.kb.api.dto.KbQaSessionListVO;
import com.mis.kb.api.dto.KbQaSessionQuery;
import com.mis.kb.api.dto.KbQaSessionVO;
import com.mis.kb.domain.service.KbOperationsService;
import com.mis.kb.domain.service.KbQaService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * 运营只读端点（A-02a/b/d/e）。
 *
 * <p>仅对运营角色开放，提供全量问答会话、反馈、看板与导出的只读视图，不含任何写操作与归属过滤；
 * 写操作（如反馈提交）仍以 {@link QaController} 的用户主体为准，工单写操作见 {@link QaTicketController}。
 *
 * <p><b>时间参数口径：</b>{@code from}/{@code to} 统一收字符串再手工解析，同时兼容
 * ISO-8601（{@code 2026-08-01T00:00:00Z}）与 epoch 毫秒（{@code 1785542400000}）两种写法。
 * 不直接声明 {@code Instant} 形参，是因为默认转换器只吃 ISO-8601，前端一旦传毫秒就直接 400，
 * 而运营页的时间控件传毫秒是常见做法——这里多写十行换掉一类联调事故。
 */
@RestController
@RequestMapping("/internal/v1/kb/operations")
public class OperationsController {

    private final KbQaService qaService;
    private final KbOperationsService operationsService;

    public OperationsController(KbQaService qaService, KbOperationsService operationsService) {
        this.qaService = qaService;
        this.operationsService = operationsService;
    }

    // ---------------------------------------------------------------- A-02b 列表

    /**
     * 运营：问答会话列表（带筛选与分页，A-02b）。
     *
     * @param from        起始时间，ISO-8601 或 epoch 毫秒；可空
     * @param to          结束时间，ISO-8601 或 epoch 毫秒；可空
     * @param libraryId   命中知识库 id；可空
     * @param userId      提问用户 id；可空
     * @param hasFeedback 是否已反馈；可空表示不限
     * @param keyword     提问内容关键字；可空
     * @param page        页码，从 1 开始
     * @param size        每页条数
     * @return 分页会话列表
     */
    @GetMapping("/qa/sessions")
    public Result<PageResult<KbQaSessionListVO>> listSessions(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) Long libraryId,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) Boolean hasFeedback,
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) Integer page,
            @RequestParam(required = false) Integer size) {
        KbQaSessionQuery query = new KbQaSessionQuery(
                parseInstant(from, false), parseInstant(to, true), libraryId, userId,
                hasFeedback, keyword, page, size);
        return Result.ok(operationsService.listSessions(query));
    }

    /**
     * 运营：问答会话详情（A-02a）。
     *
     * <p>不做归属校验——运营视角本就需要看他人会话；额外返回可见范围快照与召回参数。
     *
     * @param sessionId 会话 id
     * @return 会话详情
     */
    @GetMapping("/qa/sessions/{sessionId}")
    public Result<KbQaSessionDetailVO> getSessionDetail(@PathVariable Long sessionId) {
        return Result.ok(qaService.getSessionDetailForOperations(sessionId));
    }

    // ---------------------------------------------------------------- A-02d 看板

    /**
     * 运营：评价看板统计（A-02b/d）。
     *
     * @param from 起始时间；可空（缺省回溯 30 天）
     * @param to   结束时间；可空（缺省取当前）
     * @return 看板数据
     */
    @GetMapping("/stats")
    public Result<KbDashboardVO> stats(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        return Result.ok(operationsService.stats(parseInstant(from, false), parseInstant(to, true)));
    }

    // ---------------------------------------------------------------- A-02e 导出

    /**
     * 运营：导出行数据（A-02e）。
     *
     * <p>本端点只返回结构化行，CSV 拼装与 userId 脱敏由 BFF 完成——
     * mis-kb 是内部服务，不该关心「导出文件长什么样」这种表现层问题。
     * 行数超 {@link KbOperationsService#EXPORT_MAX_ROWS} 时直接报错要求缩小范围。
     *
     * @param from      起始时间；可空
     * @param to        结束时间；可空
     * @param libraryId 命中知识库 id；可空
     * @param userId    提问用户 id；可空
     * @param keyword   提问关键字；可空
     * @return 导出行列表
     */
    @GetMapping("/qa/export")
    public Result<List<KbQaExportRow>> export(
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(required = false) Long libraryId,
            @RequestParam(required = false) Long userId,
            @RequestParam(required = false) Boolean hasFeedback,
            @RequestParam(required = false) String keyword) {
        KbQaSessionQuery query = new KbQaSessionQuery(
                parseInstant(from, false), parseInstant(to, true), libraryId, userId,
                hasFeedback, keyword, null, null);
        return Result.ok(operationsService.exportRows(query));
    }

    // ---------------------------------------------------------------- P0 既有端点（保持兼容）

    /**
     * 运营：全量会话列表（只读，P0 既有端点）。
     *
     * <p>P0 时该能力挂在 {@code /qa/sessions}，本次被分页版 {@link #listSessions} 占用，
     * 故平移到 {@code /qa/sessions-all}。<b>刻意不用 {@code /qa/sessions/all}</b>：
     * 那会和 {@code /qa/sessions/{sessionId}} 形成字面量 vs 路径变量的竞争，
     * 虽然 Spring 会优先字面量，但这种「靠框架排序规则才不出错」的路径设计不值得留在代码里。
     *
     * <p>保留本端点是为了不打断 P0 已上线的调用方；新页面一律走分页版本。
     */
    @GetMapping("/qa/sessions-all")
    public Result<List<KbQaSessionVO>> listAllSessions() {
        return Result.ok(qaService.listAllSessions());
    }

    /** 运营：全量反馈列表（只读）。 */
    @GetMapping("/qa/feedback")
    public Result<List<KbQaFeedbackVO>> listAllFeedback() {
        return Result.ok(qaService.listAllFeedback());
    }

    // ---------------------------------------------------------------- 内部

    /**
     * 解析时间参数，兼容 ISO-8601、epoch 毫秒、以及纯日期 {@code YYYY-MM-DD}。
     *
     * <p>纯日期分支按 UTC 处理：{@code from} 取当日 {@code 00:00:00Z}，
     * {@code to} 取当日末尾 {@code 23:59:59.999999999Z}（含整天），
     * 避免前端只传日期时区间右端「少算一整天」——这正是 A-02b 看板选日期区间静默失效的根因。
     *
     * <p>向后兼容：ISO-8601 与 epoch 毫秒的语义保持不变，老调用方（含 BFF 透传的 ISO 串）不受影响。
     *
     * @param raw 原始字符串；空白返回 {@code null}
     * @param end 是否为区间右端（仅纯日期分支生效：true 时补到当日末尾）
     * @return 解析结果；无法识别时返回 {@code null}（按“不限”处理，不让筛选参数把整个页面打挂）
     */
    private static Instant parseInstant(String raw, boolean end) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        String text = raw.trim();
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException ignored) {
            // 继续尝试 epoch 毫秒
        }
        try {
            return Instant.ofEpochMilli(Long.parseLong(text));
        } catch (NumberFormatException ignored) {
            // 继续尝试纯日期
        }
        try {
            LocalDate date = LocalDate.parse(text, DateTimeFormatter.ISO_LOCAL_DATE);
            return end
                    ? date.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant().minusNanos(1)
                    : date.atStartOfDay(ZoneOffset.UTC).toInstant();
        } catch (DateTimeParseException ignored) {
            return null;
        }
    }
}
