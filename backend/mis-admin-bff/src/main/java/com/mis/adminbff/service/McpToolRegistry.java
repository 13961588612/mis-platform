package com.mis.adminbff.service;

import org.springframework.stereotype.Component;

import java.util.Set;

/**
 * MCP 工具白名单注册表。
 *
 * <p>P0 阶段硬编码允许调用的工具集合，T04 阶段将从 SkillDefinition 动态加载。</p>
 */
@Component
public class McpToolRegistry {

    private static final Set<String> ALLOWED_TOOLS = Set.of(
            "queryOrgByName",
            "queryDeptByName",
            "queryEmployeeByName"
    );

    /**
     * 检查指定工具是否在允许列表中。
     */
    public boolean isAllowed(String toolName) {
        return ALLOWED_TOOLS.contains(toolName);
    }
}
