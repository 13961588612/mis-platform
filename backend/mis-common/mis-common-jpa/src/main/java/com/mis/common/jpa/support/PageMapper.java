package com.mis.common.jpa.support;

import com.mis.common.core.result.PageResult;
import org.springframework.data.domain.Page;

import java.util.List;

/**
 * Spring Data {@link Page} → {@link PageResult} 转换。
 */
public final class PageMapper {

    private PageMapper() {
    }

    public static <T> PageResult<T> toPageResult(Page<T> page) {
        List<T> content = page.getContent();
        return PageResult.of(
                page.getNumber() + 1,
                page.getSize(),
                page.getTotalElements(),
                content
        );
    }
}
