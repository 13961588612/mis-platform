package com.mis.recon.common;

import lombok.Data;
import org.springframework.data.domain.Page;

import java.util.List;

/**
 * 分页结果（G17）：page 对外 1-based，pages 必含（前端分页组件需要总页数）。
 */
@Data
public class PageResult<T> {
    private List<T> list;
    private long total;
    private int page;
    private int size;
    private int pages;

    public static <T> PageResult<T> from(Page<T> springPage) {
        PageResult<T> r = new PageResult<>();
        r.list = springPage.getContent();
        r.total = springPage.getTotalElements();
        r.page = springPage.getNumber() + 1;
        r.size = springPage.getSize();
        r.pages = springPage.getTotalPages();
        return r;
    }
}
