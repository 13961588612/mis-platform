package com.mis.recon.controller;

import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;

/**
 * 分页参数规范（G17，全局一致）：page 从 1 开始（前端惯例）-> Spring 0-based；
 * size 默认 20、上限 100（防恶意大分页）；列表默认排序 updated_at DESC。
 */
public final class PageSupport {

    private PageSupport() {
    }

    public static PageRequest normalize(int page, int size) {
        return PageRequest.of(Math.max(page, 1) - 1,
                Math.min(Math.max(size, 1), 100),
                Sort.by(Sort.Direction.DESC, "updatedAt")
                        .and(Sort.by(Sort.Direction.DESC, "id"))); // id 兜底：updated_at 并列时顺序确定，避免每次刷新列表乱序
    }
}
