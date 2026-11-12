package com.mis.taskflow.service;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * 默认审批人提供者（P5）。
 *
 * <p>本地/联调阶段：不接入 org/iam，直接取规则 {@code value} 字段作为 userId
 * （支持数字或数字数组）。{@code ORG_POST}（value 为对象或对象数组）此处无法解析，返回空列表，
 * 由 {@link AssignmentResolver} 给出明确错误。接入真实组织任职查询后，替换本 Bean 即可。
 */
@Component
public class DefaultAssigneeProvider implements AssigneeProvider {

    @Override
    public List<Long> resolve(String ruleType, JsonNode rule, AssignmentResolver.AssignmentContext context) {
        JsonNode value = rule.get("value");
        if (value == null || value.isNull()) {
            return List.of();
        }
        if (value.isArray()) {
            List<Long> ids = new ArrayList<>();
            value.forEach(n -> {
                if (n.canConvertToLong()) ids.add(n.asLong());
            });
            return ids;
        }
        if (value.canConvertToLong()) {
            return List.of(value.asLong());
        }
        return List.of();
    }
}
