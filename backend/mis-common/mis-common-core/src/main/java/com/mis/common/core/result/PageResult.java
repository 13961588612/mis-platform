package com.mis.common.core.result;

import java.io.Serializable;
import java.util.Collections;
import java.util.List;

/**
 * 分页响应。
 */
public class PageResult<T> implements Serializable {

    private int page;
    private int size;
    private long total;
    private List<T> list;

    public PageResult() {
    }

    public PageResult(int page, int size, long total, List<T> list) {
        this.page = page;
        this.size = size;
        this.total = total;
        this.list = list != null ? list : Collections.emptyList();
    }

    public static <T> PageResult<T> of(int page, int size, long total, List<T> list) {
        return new PageResult<>(page, size, total, list);
    }

    public static <T> PageResult<T> empty(int page, int size) {
        return new PageResult<>(page, size, 0, Collections.emptyList());
    }

    public int getPage() {
        return page;
    }

    public void setPage(int page) {
        this.page = page;
    }

    public int getSize() {
        return size;
    }

    public void setSize(int size) {
        this.size = size;
    }

    public long getTotal() {
        return total;
    }

    public void setTotal(long total) {
        this.total = total;
    }

    public List<T> getList() {
        return list;
    }

    public void setList(List<T> list) {
        this.list = list;
    }
}
