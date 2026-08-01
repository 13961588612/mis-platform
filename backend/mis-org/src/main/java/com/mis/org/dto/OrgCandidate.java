package com.mis.org.dto;

import java.util.List;

/**
 * MCP 工具查询组织时返回的候选结果。
 */
public class OrgCandidate {

    private Long id;
    private String name;
    private List<String> aliases;
    private String context;

    public OrgCandidate() {
    }

    public OrgCandidate(Long id, String name, List<String> aliases, String context) {
        this.id = id;
        this.name = name;
        this.aliases = aliases;
        this.context = context;
    }

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
