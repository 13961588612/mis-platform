package com.mis.taskflow.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 审批人解析器（P5）。
 *
 * <p>支持规则类型（{@code assigneeRule.type}）：
 * <ul>
 *   <li>{@code SELF}       —— 发起人本人</li>
 *   <li>{@code FIXED}      —— 固定人员（value = userId）</li>
 *   <li>{@code USER_LIST}  —— 指定人员列表（value = [userId,...]）</li>
 *   <li>{@code SUPERVISOR} —— 上级主管（委托 {@link AssigneeProvider}）</li>
 *   <li>{@code ROLE}       —— 角色（委托 {@link AssigneeProvider}）</li>
 *   <li>{@code DEPT_LEADER}—— 部门领导（委托 {@link AssigneeProvider}）</li>
 *   <li>{@code ORG_POST}   —— 公司+部门+岗位（value = [{orgId,deptId,postId},...] 或单对象，委托 {@link AssigneeProvider}）</li>
 * </ul>
 *
 * <p>需要组织/角色/岗位数据的规则通过 {@link AssigneeProvider} 扩展点解析（当前默认实现
 * 从规则 value 直接取 userId，便于本地联调；接入 org/iam 后替换实现即可）。
 */
@Component
public class AssignmentResolver {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final AssigneeProvider provider;

    public AssignmentResolver(AssigneeProvider provider) {
        this.provider = provider;
    }

    /**
     * 解析某节点应分配给谁。
     *
     * @param assigneeRuleJson 节点审批人规则 JSON
     * @param context          解析上下文（发起人、业务数据等）
     * @return 处理人 userId 列表（去重，至少一个）
     */
    public List<Long> resolve(String assigneeRuleJson, AssignmentContext context) {
        JsonNode rule;
        try {
            rule = MAPPER.readTree(assigneeRuleJson == null || assigneeRuleJson.isBlank() ? "{}" : assigneeRuleJson);
        } catch (Exception e) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "审批人规则 JSON 非法: " + assigneeRuleJson);
        }
        String type = rule.path("type").asText("SELF").toUpperCase();
        return switch (type) {
            case "SELF" -> List.of(context.initiatorId());
            case "FIXED" -> List.of(requireLong(rule, "value"));
            case "USER_LIST" -> readUserList(rule);
            case "SUPERVISOR", "ROLE", "DEPT_LEADER", "ORG_POST" -> {
                if ("ORG_POST".equals(type)) {
                    validateOrgPostValue(rule.get("value"));
                }
                List<Long> resolved = provider.resolve(type, rule, context);
                if (resolved == null || resolved.isEmpty()) {
                    throw new BusinessException(ResultCode.VALIDATION_ERROR,
                            "ORG_POST".equals(type)
                                    ? "无法按组织/部门/岗位解析审批人，请确认岗位已配置任职人员且组织服务已接入"
                                    : "无法解析审批人规则 type=" + type + " value=" + rule.path("value").asText());
                }
                yield resolved;
            }
            default -> throw new BusinessException(ResultCode.VALIDATION_ERROR, "不支持的审批人规则类型: " + type);
        };
    }

    private static Long requireLong(JsonNode rule, String field) {
        JsonNode node = rule.get(field);
        if (node == null || !node.canConvertToLong()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "规则缺少合法的 " + field + "（userId）");
        }
        return node.asLong();
    }

    private static List<Long> readUserList(JsonNode rule) {
        JsonNode value = rule.get("value");
        if (value == null || !value.isArray()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "USER_LIST 规则的 value 必须是数组");
        }
        List<Long> ids = new ArrayList<>();
        value.forEach(n -> {
            if (n.canConvertToLong()) {
                ids.add(n.asLong());
            }
        });
        if (ids.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "USER_LIST 规则解析结果为空");
        }
        return ids;
    }

    /**
     * ORG_POST value：支持 {@code [{orgId,deptId,postId},...]}，兼容旧版单对象。
     */
    private static void validateOrgPostValue(JsonNode value) {
        if (value == null || value.isNull()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "ORG_POST 规则的 value 须为 [{orgId, deptId, postId},...] 或单对象");
        }
        if (value.isArray()) {
            if (value.isEmpty()) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "ORG_POST 规则至少选择一个岗位");
            }
            for (JsonNode item : value) {
                requireOrgPostObject(item);
            }
            return;
        }
        requireOrgPostObject(value);
    }

    private static void requireOrgPostObject(JsonNode v) {
        if (v == null || !v.isObject()
                || !v.path("orgId").canConvertToLong()
                || !v.path("deptId").canConvertToLong()
                || !v.path("postId").canConvertToLong()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR,
                    "ORG_POST 规则的 value 项须为 {orgId, deptId, postId}");
        }
    }

    /** 审批人解析上下文。 */
    public record AssignmentContext(Long tenantId, Long initiatorId, String businessType, String businessId) {
    }
}
