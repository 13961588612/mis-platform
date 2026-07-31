package com.mis.adminbff.dto.ai;

import java.util.List;

/**
 * 实体候选结果 DTO。
 * 当实体模糊匹配存在多个候选时，用于 HITL 交互让用户选择。
 */
public class EntityCandidate {

    /** 实体 ID。 */
    private Object id;

    /** 实体名称。 */
    private String name = "";

    /** 别名列表。 */
    private List<String> aliases = List.of();

    /** 附加上下文信息（如部门全称、组织层级等）。 */
    private String context = "";

    public Object getId() {
        return id;
    }

    public void setId(Object id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public List<String> getAliases() {
        return aliases;
    }

    public void setAliases(List<String> aliases) {
        this.aliases = aliases;
    }

    public String getContext() {
        return context;
    }

    public void setContext(String context) {
        this.context = context;
    }
}
