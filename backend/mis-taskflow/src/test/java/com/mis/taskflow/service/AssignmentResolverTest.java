package com.mis.taskflow.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * {@link AssignmentResolver} 单测（P5）：六种审批人规则。
 *
 * <p>规则 JSON 用 Jackson 序列化构造，避免手写转义出错。
 */
class AssignmentResolverTest {

    private static final ObjectMapper M = new ObjectMapper();

    private final AssignmentResolver resolver = new AssignmentResolver(new DefaultAssigneeProvider());
    private final AssignmentResolver.AssignmentContext ctx =
            new AssignmentResolver.AssignmentContext(1L, 100L, "PURCHASE_ORDER", "PO-1");

    private static String json(Map<String, Object> rule) {
        try {
            return M.writeValueAsString(rule);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    @Test
    @DisplayName("SELF 解析为发起人")
    void self() {
        assertEquals(List.of(100L), resolver.resolve(json(Map.of("type", "SELF")), ctx));
    }

    @Test
    @DisplayName("FIXED 解析为固定人员")
    void fixed() {
        assertEquals(List.of(200L), resolver.resolve(json(Map.of("type", "FIXED", "value", 200)), ctx));
    }

    @Test
    @DisplayName("USER_LIST 解析为多人并保留顺序")
    void userList() {
        assertEquals(List.of(201L, 202L, 203L),
                resolver.resolve(json(Map.of("type", "USER_LIST", "value", List.of(201, 202, 203))), ctx));
    }

    @Test
    @DisplayName("SUPERVISOR 委托 provider 解析")
    void supervisor() {
        assertEquals(List.of(300L), resolver.resolve(json(Map.of("type", "SUPERVISOR", "value", 300)), ctx));
    }

    @Test
    @DisplayName("ROLE 委托 provider 解析")
    void role() {
        assertEquals(List.of(401L, 402L),
                resolver.resolve(json(Map.of("type", "ROLE", "value", List.of(401, 402))), ctx));
    }

    @Test
    @DisplayName("DEPT_LEADER 委托 provider 解析")
    void deptLeader() {
        assertEquals(List.of(500L), resolver.resolve(json(Map.of("type", "DEPT_LEADER", "value", 500)), ctx));
    }

    @Test
    @DisplayName("缺省类型按 SELF 处理")
    void defaultSelf() {
        assertEquals(List.of(100L), resolver.resolve("{}", ctx));
    }

    @Test
    @DisplayName("非法规则抛业务异常")
    void invalid() {
        assertThrows(BusinessException.class, () -> resolver.resolve("not-json", ctx));
        assertThrows(BusinessException.class, () -> resolver.resolve(json(Map.of("type", "UNKNOWN")), ctx));
        assertThrows(BusinessException.class, () -> resolver.resolve(json(Map.of("type", "FIXED")), ctx));
        assertThrows(BusinessException.class, () -> resolver.resolve(json(Map.of("type", "USER_LIST", "value", List.of())), ctx));
        assertThrows(BusinessException.class, () -> resolver.resolve(json(Map.of("type", "ROLE")), ctx));
    }
}