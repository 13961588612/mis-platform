package com.mis.taskflow.service;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

/**
 * 审批人数据来源扩展点（P5）。
 *
 * <p>SUPERVISOR / ROLE / DEPT_LEADER 等需要组织或角色数据的规则委托给本接口，
 * 由部署侧替换实现（例如经 JWT 调 mis-org / mis-iam）。默认实现见
 * {@link DefaultAssigneeProvider}。
 */
@FunctionalInterface
public interface AssigneeProvider {

    List<Long> resolve(String ruleType, JsonNode rule, AssignmentResolver.AssignmentContext context);
}
