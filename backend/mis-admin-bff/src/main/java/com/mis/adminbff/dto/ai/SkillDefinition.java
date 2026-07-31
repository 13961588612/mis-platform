package com.mis.adminbff.dto.ai;

import java.util.Map;

/**
 * Skill JSON 反序列化模型，表示一个表单智能填充技能配置。
 * 通过 {@code outputSchema} 定义该 Skill 能填充的字段及其获取方式。
 */
public class SkillDefinition {

    /** Skill 唯一标识，如 "user-fill"。 */
    private String id = "";

    /** Skill 展示名称。 */
    private String name = "";

    /** 版本号。 */
    private String version = "";

    /** 触发器模板，如 "把 {person} 调到 {dept}"。 */
    private String trigger = "";

    /** 输出字段定义，key 为字段名，value 为字段获取方式。 */
    private Map<String, FieldDef> outputSchema = Map.of();

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getVersion() {
        return version;
    }

    public void setVersion(String version) {
        this.version = version;
    }

    public String getTrigger() {
        return trigger;
    }

    public void setTrigger(String trigger) {
        this.trigger = trigger;
    }

    public Map<String, FieldDef> getOutputSchema() {
        return outputSchema;
    }

    public void setOutputSchema(Map<String, FieldDef> outputSchema) {
        this.outputSchema = outputSchema;
    }
}
