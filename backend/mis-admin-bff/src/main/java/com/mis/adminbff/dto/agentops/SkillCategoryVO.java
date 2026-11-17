package com.mis.adminbff.dto.agentops;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.util.ArrayList;
import java.util.List;

/** 技能分类树节点（BFF 自建，表 {@code ai_skill_category}）。 */
public class SkillCategoryVO {

    private Long id;

    @JsonProperty("parent_id")
    private Long parentId;

    private String name;

    @JsonProperty("sort_order")
    private Integer sortOrder;

    private List<SkillCategoryVO> children = new ArrayList<>();

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getParentId() {
        return parentId;
    }

    public void setParentId(Long parentId) {
        this.parentId = parentId;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public Integer getSortOrder() {
        return sortOrder;
    }

    public void setSortOrder(Integer sortOrder) {
        this.sortOrder = sortOrder;
    }

    public List<SkillCategoryVO> getChildren() {
        return children;
    }

    public void setChildren(List<SkillCategoryVO> children) {
        this.children = children == null ? new ArrayList<>() : children;
    }
}
