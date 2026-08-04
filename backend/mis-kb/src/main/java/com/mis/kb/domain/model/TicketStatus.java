package com.mis.kb.domain.model;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * 工单状态机（A-02c）。
 *
 * <p>合法流转：
 * <pre>
 *   open       → processing | closed
 *   processing → resolved   | closed
 *   resolved   → closed | processing（回退重开）
 *   closed     → （终态，不可再流转）
 * </pre>
 * 非法流转由 {@link com.mis.kb.domain.service.KbQaTicketService} 抛
 * {@link KbResultCode#KB_TICKET_STATUS_ILLEGAL}。
 */
public enum TicketStatus {

    OPEN("open"),
    PROCESSING("processing"),
    RESOLVED("resolved"),
    CLOSED("closed");

    private static final Map<TicketStatus, List<TicketStatus>> TRANSITIONS = Map.of(
            OPEN, List.of(PROCESSING, CLOSED),
            PROCESSING, List.of(RESOLVED, CLOSED),
            RESOLVED, List.of(CLOSED, PROCESSING),
            CLOSED, List.of());

    private final String code;

    TicketStatus(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }

    /**
     * 由码值解析枚举。
     *
     * @param code 码值（大小写不敏感）
     * @return 匹配的枚举；无匹配返回 {@code null}
     */
    public static TicketStatus fromCode(String code) {
        if (code == null || code.isBlank()) {
            return null;
        }
        String lower = code.trim().toLowerCase();
        return Arrays.stream(values())
                .filter(v -> v.code.equals(lower))
                .findFirst()
                .orElse(null);
    }

    public static boolean isValid(String code) {
        return fromCode(code) != null;
    }

    /**
     * 判断状态流转是否合法。
     *
     * <p>幂等流转（from == to）视为合法，便于前端重复提交不报错。
     *
     * @param from 原状态
     * @param to   目标状态
     * @return 合法返回 {@code true}
     */
    public static boolean canTransit(TicketStatus from, TicketStatus to) {
        if (from == null || to == null) {
            return false;
        }
        if (from == to) {
            return true;
        }
        return TRANSITIONS.getOrDefault(from, List.of()).contains(to);
    }

    /** 是否终态。 */
    public boolean isTerminal() {
        return this == CLOSED;
    }
}
