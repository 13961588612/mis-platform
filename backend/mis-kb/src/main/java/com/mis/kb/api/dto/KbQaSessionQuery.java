package com.mis.kb.api.dto;

import java.time.Instant;

/**
 * 运营问答列表筛选条件（A-02b / A-02e 共用）。
 *
 * <p>所有字段可空，空即「不限」。分页页码从 1 开始。
 *
 * @param from        起始时间（含）
 * @param to          结束时间（含）
 * @param libraryId   命中知识库 id
 * @param userId      提问用户 id
 * @param hasFeedback 是否已反馈；{@code null} 表示不限
 * @param keyword     提问内容关键字（大小写不敏感的包含匹配）
 * @param page        页码，从 1 开始
 * @param size        每页条数
 */
public record KbQaSessionQuery(
        Instant from,
        Instant to,
        Long libraryId,
        Long userId,
        Boolean hasFeedback,
        String keyword,
        Integer page,
        Integer size) {

    /** 默认页码。 */
    public static final int DEFAULT_PAGE = 1;
    /** 默认每页条数。 */
    public static final int DEFAULT_SIZE = 20;
    /** 每页条数上限，防止一次拉爆内存。 */
    public static final int MAX_SIZE = 200;

    /** 归一化后的页码（≥1）。 */
    public int effectivePage() {
        return page == null || page < 1 ? DEFAULT_PAGE : page;
    }

    /** 归一化后的每页条数（1~{@link #MAX_SIZE}）。 */
    public int effectiveSize() {
        if (size == null || size < 1) {
            return DEFAULT_SIZE;
        }
        return Math.min(size, MAX_SIZE);
    }
}
