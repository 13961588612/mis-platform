package com.mis.iqd.api.dto;

import java.util.ArrayList;
import java.util.List;

/**
 * 依赖方清单（v1.11 系统设计 §5 {@code IqdDependents}；snake_case wire）。
 *
 * <p>{@code GET /api/v1/iqd/dependencies?connectionId=&itemKey=} 出参：
 * {@code {dependents:[{item_key,kind}], total}}。
 */
public class IqdDependents {

    /** 直接引用方列表（空列表 = 无引用，可安全删除）。 */
    private List<Dependent> dependents = new ArrayList<>();

    /** 引用方总数（= {@code dependents.size()}；显式回传便于前端分页扩展）。 */
    private int total;

    public IqdDependents() {
    }

    public IqdDependents(List<Dependent> dependents) {
        this.dependents = dependents == null ? new ArrayList<>() : dependents;
        this.total = this.dependents.size();
    }

    public List<Dependent> getDependents() {
        return dependents;
    }

    public void setDependents(List<Dependent> dependents) {
        this.dependents = dependents == null ? new ArrayList<>() : dependents;
        this.total = this.dependents.size();
    }

    public int getTotal() {
        return total;
    }

    public void setTotal(int total) {
        this.total = total;
    }
}
