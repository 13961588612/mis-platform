package com.mis.iqd.api.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 脱敏规则响应 VO（GET /api/v1/iqd/mask/rules；snake_case wire）。
 */
public class IqdMaskRuleVO {

    private Long id;
    private String name;
    private String matchType;
    private String pattern;
    private String rule;
    private String replacement;
    private Integer priority;
    private Boolean enabled;

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getMatchType() {
        return matchType;
    }

    public void setMatchType(String matchType) {
        this.matchType = matchType;
    }

    public String getPattern() {
        return pattern;
    }

    public void setPattern(String pattern) {
        this.pattern = pattern;
    }

    public String getRule() {
        return rule;
    }

    public void setRule(String rule) {
        this.rule = rule;
    }

    public String getReplacement() {
        return replacement;
    }

    public void setReplacement(String replacement) {
        this.replacement = replacement;
    }

    public Integer getPriority() {
        return priority;
    }

    public void setPriority(Integer priority) {
        this.priority = priority;
    }

    public Boolean getEnabled() {
        return enabled;
    }

    public void setEnabled(Boolean enabled) {
        this.enabled = enabled;
    }

    @JsonProperty("match_type")
    public String matchTypeWire() {
        return matchType;
    }

    @JsonProperty("rule")
    public String ruleWire() {
        return rule;
    }

    @JsonProperty("priority")
    public Integer priorityWire() {
        return priority;
    }
}
