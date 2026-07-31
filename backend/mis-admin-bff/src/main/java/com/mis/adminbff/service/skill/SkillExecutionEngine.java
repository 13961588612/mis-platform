package com.mis.adminbff.service.skill;

import com.mis.adminbff.dto.ai.*;
import com.mis.adminbff.service.McpClient;
import com.mis.adminbff.service.McpToolRegistry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 核心执行引擎。
 *
 * <p>职责：加载 Skill → 构建 DAG → 拓扑排序 → 按序解析参数 → 调 MCP → 组装结果。
 * 覆盖四种执行状态：success / hitl_required / manual_required / error。</p>
 */
@Service
public class SkillExecutionEngine {

    private static final Logger log = LoggerFactory.getLogger(SkillExecutionEngine.class);

    private static final Pattern PARAM_REF = Pattern.compile("\\$\\{(\\w+)\\}");

    private final SkillLoader skillLoader;
    private final DagBuilder dagBuilder;
    private final ParameterResolver paramResolver;
    private final McpClient mcpClient;
    private final McpToolRegistry toolRegistry;
    private final ObjectMapper objectMapper;

    public SkillExecutionEngine(SkillLoader skillLoader, DagBuilder dagBuilder,
                                ParameterResolver paramResolver, McpClient mcpClient,
                                McpToolRegistry toolRegistry, ObjectMapper objectMapper) {
        this.skillLoader = skillLoader;
        this.dagBuilder = dagBuilder;
        this.paramResolver = paramResolver;
        this.mcpClient = mcpClient;
        this.toolRegistry = toolRegistry;
        this.objectMapper = objectMapper;
    }

    /**
     * 执行 Skill 填充。
     *
     * @param skillId     Skill ID
     * @param userInput   用户输入（自然语言）
     * @param pageContext 表单已填值
     * @param userId      当前用户
     * @param tenantId    租户
     * @return 执行结果
     */
    public SkillExecuteResponse execute(String skillId, String userInput,
                                        Map<String, Object> pageContext,
                                        Long userId, Long tenantId) {
        // 1. 加载 Skill
        SkillDefinition skill = skillLoader.loadSkill(skillId);
        if (skill == null) {
            log.warn("Skill not found: {}", skillId);
            return error("Skill not found: " + skillId);
        }

        // 2. 构建 DAG + 拓扑排序
        List<String> executionOrder;
        try {
            executionOrder = dagBuilder.topologicalSort(skill.getOutputSchema());
        } catch (IllegalArgumentException e) {
            log.error("DAG build failed for skill {}: {}", skillId, e.getMessage());
            return error("Circular dependency in skill schema: " + e.getMessage());
        }

        // 3. 按序执行每个字段
        Map<String, Object> results = new LinkedHashMap<>();

        for (String field : executionOrder) {
            FieldDef fieldDef = skill.getOutputSchema().get(field);
            if (fieldDef == null) {
                continue;
            }

            // 非实体字段：从 LLM 抽取或上下文获取
            if (fieldDef.getEntityRef() == null) {
                Object value = paramResolver.resolveNonEntity(fieldDef, userInput, pageContext, results);
                results.put(field, value);
                continue;
            }

            // 实体字段：解析参数 → 调 MCP → 处理结果
            Map<String, Object> resolvedParams = paramResolver.resolve(fieldDef, userInput, pageContext, results);

            // 白名单校验
            if (!toolRegistry.isAllowed(fieldDef.getTool())) {
                log.warn("Tool not allowed: {}", fieldDef.getTool());
                return error("Tool not allowed: " + fieldDef.getTool());
            }

            // 调用 MCP 工具
            JsonNode mcpResult;
            try {
                mcpResult = mcpClient.callTool(getServerKey(fieldDef.getEntityRef()),
                        fieldDef.getTool(), resolvedParams, userId, tenantId);
            } catch (Exception e) {
                log.error("MCP call failed for tool {}: {}", fieldDef.getTool(), e.getMessage());
                return error("MCP call failed: " + e.getMessage());
            }

            // 解析 MCP 结果
            List<EntityCandidate> candidates = parseCandidates(mcpResult);

            if (candidates.isEmpty()) {
                // 无匹配 → 标记 manual_required
                String originalName = (String) resolvedParams.get("name");
                log.info("No candidates found for field '{}', name='{}'", field, originalName);
                return manualRequired(field, fieldDef, originalName);
            } else if (candidates.size() == 1) {
                // 唯一匹配 → 直接用
                results.put(field, candidates.get(0).getId());
                log.info("Field '{}' resolved to candidate id={}", field, candidates.get(0).getId());
            } else {
                // 多匹配 → 返回 HITL
                String originalName = (String) resolvedParams.get("name");
                log.info("Multiple candidates for field '{}', returning HITL", field);
                return hitlRequired(field, fieldDef, originalName, candidates);
            }
        }

        return success(results);
    }

    /**
     * 根据实体引用推断 MCP 服务器 key。
     */
    private String getServerKey(String entityRef) {
        if (entityRef == null) {
            return "system";
        }
        return switch (entityRef) {
            case "org", "dept" -> "org";
            case "employee", "user" -> "iam";
            default -> "system";
        };
    }

    /**
     * 从 MCP 标准格式中解析候选实体列表。
     * <p>预期格式：
     * {"content":[{"type":"resource","resource":{"uri":"...","text":"[{...}]"}}]}</p>
     */
    private List<EntityCandidate> parseCandidates(JsonNode mcpResult) {
        List<EntityCandidate> candidates = new ArrayList<>();
        if (mcpResult == null) {
            return candidates;
        }
        try {
            JsonNode content = mcpResult.get("content");
            if (content == null || !content.isArray() || content.isEmpty()) {
                return candidates;
            }
            JsonNode firstContent = content.get(0);
            JsonNode resource = firstContent.get("resource");
            if (resource == null) {
                return candidates;
            }
            String text = resource.path("text").asText();
            if (text == null || text.isEmpty()) {
                return candidates;
            }
            JsonNode array = objectMapper.readTree(text);
            if (!array.isArray()) {
                return candidates;
            }
            for (JsonNode node : array) {
                EntityCandidate c = new EntityCandidate();
                JsonNode idNode = node.get("id");
                if (idNode != null && !idNode.isNull()) {
                    c.setId(idNode.isLong() ? idNode.asLong() : idNode.asText());
                }
                JsonNode nameNode = node.get("name");
                if (nameNode != null) {
                    c.setName(nameNode.asText(""));
                }
                JsonNode aliasesNode = node.get("aliases");
                if (aliasesNode != null && aliasesNode.isArray()) {
                    List<String> aliases = new ArrayList<>();
                    for (JsonNode a : aliasesNode) {
                        aliases.add(a.asText());
                    }
                    c.setAliases(aliases);
                }
                JsonNode contextNode = node.get("context");
                if (contextNode != null) {
                    c.setContext(contextNode.asText(""));
                }
                candidates.add(c);
            }
        } catch (Exception e) {
            log.warn("Failed to parse MCP candidates: {}", e.getMessage());
        }
        return candidates;
    }

    private SkillExecuteResponse success(Map<String, Object> fields) {
        SkillExecuteResponse resp = new SkillExecuteResponse();
        resp.setStatus("success");
        resp.setFields(fields);
        resp.setMessage("填充完成");
        return resp;
    }

    private SkillExecuteResponse error(String message) {
        SkillExecuteResponse resp = new SkillExecuteResponse();
        resp.setStatus("error");
        resp.setMessage(message);
        return resp;
    }

    private SkillExecuteResponse manualRequired(String field, FieldDef fieldDef, String originalValue) {
        SkillExecuteResponse resp = new SkillExecuteResponse();
        resp.setStatus("manual_required");
        String ref = fieldDef != null ? fieldDef.getEntityRef() : "实体";
        resp.setMessage("未找到匹配的" + ref + "：" + originalValue);
        return resp;
    }

    private SkillExecuteResponse hitlRequired(String field, FieldDef fieldDef,
                                              String originalValue, List<EntityCandidate> candidates) {
        HitlPayload hitl = new HitlPayload();
        hitl.setField(field);
        hitl.setOriginalValue(originalValue != null ? originalValue : "");
        hitl.setCandidates(candidates);

        SkillExecuteResponse resp = new SkillExecuteResponse();
        resp.setStatus("hitl_required");
        resp.setHitl(hitl);
        resp.setMessage("找到多个候选结果，请手动选择");
        return resp;
    }
}
