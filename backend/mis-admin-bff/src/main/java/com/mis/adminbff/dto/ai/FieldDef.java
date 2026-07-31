package com.mis.adminbff.dto.ai;

import java.util.Map;

/**
 * 字段定义，对应 Skill outputSchema 中的单个字段。
 * 描述该字段的数据类型、引用的实体类型、调用的 MCP 工具及其参数模板。
 */
public class FieldDef {

    /** 数据类型，如 "integer", "string" 等。 */
    private String type = "";

    /** 实体引用标识，如 "org", "dept", "employee"；null 表示非实体字段。 */
    private String entityRef;

    /** MCP 工具名称，如 "queryOrgByName"。 */
    private String tool = "";

    /** 工具参数模板，支持 ${xxx} 占位符，如 {"name": "${orgName}"}。 */
    private Map<String, String> params = Map.of();

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getEntityRef() {
        return entityRef;
    }

    public void setEntityRef(String entityRef) {
        this.entityRef = entityRef;
    }

    public String getTool() {
        return tool;
    }

    public void setTool(String tool) {
        this.tool = tool;
    }

    public Map<String, String> getParams() {
        return params;
    }

    public void setParams(Map<String, String> params) {
        this.params = params;
    }
}
