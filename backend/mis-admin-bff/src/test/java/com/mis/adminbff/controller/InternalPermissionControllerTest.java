package com.mis.adminbff.controller;

import com.mis.adminbff.dto.internal.InternalPermissionsVO;
import com.mis.adminbff.security.SkillPermissionChecker;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link InternalPermissionController} 单测。
 *
 * <p><b>本测试锁住的是一份跨语言契约</b>，不是普通的 CRUD 回归：
 * ai-platform 的 {@code MisPermissionResolver._parse_codes} 只认
 * {@code data.codes} / {@code data.permissionCodes}。字段一旦改名或结构一旦变形，
 * Python 侧解析失败 ⇒ 抛 {@code PermissionUnavailable} ⇒ 每一次 skill / MCP 调用
 * 都被 fail-closed 拒绝。那正是本次修复前的线上现象，且 Java 侧不会有任何报错，
 * 所以只能靠这里的断言把结构钉死。
 */
@ExtendWith(MockitoExtension.class)
class InternalPermissionControllerTest {

    @Mock
    private SkillPermissionChecker skillPermissionChecker;

    @InjectMocks
    private InternalPermissionController controller;

    @Nested
    @DisplayName("正常查询")
    class HappyPath {

        @Test
        @DisplayName("返回 code=0 且 data.codes 为该用户权限码（排序输出）")
        void returnsCodesForUser() {
            Set<String> raw = new LinkedHashSet<>(List.of(
                    "ai:skill:member.profile:run", "ai:mcp:call", "ai:skill:Order-Query:run"));
            when(skillPermissionChecker.resolvePermissionCodes(1001L)).thenReturn(raw);

            Result<InternalPermissionsVO> result = controller.permissions("1001", null);

            assertEquals(ResultCode.SUCCESS.getCode(), result.getCode());
            assertEquals(1001L, result.getData().userId());
            // 排序输出：可复现、便于与缓存内容比对
            assertEquals(
                    List.of("ai:mcp:call", "ai:skill:Order-Query:run", "ai:skill:member.profile:run"),
                    result.getData().codes());
        }

        @Test
        @DisplayName("权限码原样保留：不 lower、不改写点号与连字符（跨语言逐字节一致）")
        void preservesCodeSpellingExactly() {
            when(skillPermissionChecker.resolvePermissionCodes(7L))
                    .thenReturn(Set.of("ai:skill:CRM-Lookup:run", "ai:skill:a.b:run"));

            List<String> codes = controller.permissions("7", "system").getData().codes();

            assertTrue(codes.contains("ai:skill:CRM-Lookup:run"));
            assertTrue(codes.contains("ai:skill:a.b:run"));
        }

        @Test
        @DisplayName("用户确实没有任何码 → 返回空数组（合法结果，不是错误）")
        void emptyCodeSetIsALegitimateAnswer() {
            when(skillPermissionChecker.resolvePermissionCodes(1001L)).thenReturn(Set.of());

            Result<InternalPermissionsVO> result = controller.permissions("1001", null);

            assertEquals(ResultCode.SUCCESS.getCode(), result.getCode());
            assertEquals(List.of(), result.getData().codes());
        }

        @Test
        @DisplayName("userId 前后空白被容忍（调用方拼串偶发空格不该变成 500）")
        void trimsUserId() {
            when(skillPermissionChecker.resolvePermissionCodes(1001L)).thenReturn(Set.of("x"));

            assertEquals(1001L, controller.permissions(" 1001 ", null).getData().userId());
        }

        @Test
        @DisplayName("appId 只作日志维度，不影响取码链路")
        void appIdDoesNotChangeLookup() {
            when(skillPermissionChecker.resolvePermissionCodes(1001L)).thenReturn(Set.of("x"));

            assertEquals(List.of("x"), controller.permissions("1001", "system").getData().codes());
            verify(skillPermissionChecker).resolvePermissionCodes(1001L);
        }
    }

    @Nested
    @DisplayName("fail-closed：错误绝不退化成空集")
    class FailClosed {

        @Test
        @DisplayName("权限源不可用 → 原样抛出 ACL_UNAVAILABLE，绝不返回空 codes")
        void aclUnavailablePropagates() {
            when(skillPermissionChecker.resolvePermissionCodes(1001L)).thenThrow(
                    new BusinessException(AgentOpsErrorCodes.ACL_UNAVAILABLE, "权限源不可用",
                            Map.of("reason", "iam_unavailable")));

            BusinessException ex = assertThrows(BusinessException.class,
                    () -> controller.permissions("1001", null),
                    "源不可用必须让调用方看见错误码；吞成空集会被 Python 侧当作"
                            + "「查到了，该用户没有任何码」并缓存 300s");

            assertEquals(AgentOpsErrorCodes.ACL_UNAVAILABLE, ex.getCode());
        }

        @Test
        @DisplayName("userId 缺失 → 参数错误，而不是查一个 null 用户")
        void blankUserIdRejected() {
            BusinessException ex = assertThrows(BusinessException.class,
                    () -> controller.permissions("  ", null));

            assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
            verify(skillPermissionChecker, never()).resolvePermissionCodes(anyLong());
        }

        @Test
        @DisplayName("userId 非数字 → 参数错误 40001，而不是 50000 系统错误")
        void nonNumericUserIdRejected() {
            BusinessException ex = assertThrows(BusinessException.class,
                    () -> controller.permissions("abc", null),
                    "直接声明 Long 接参会抛类型转换异常 → 全局处理器落成 50000，"
                            + "把调用方传错参伪装成 BFF 故障");

            assertEquals(ResultCode.VALIDATION_ERROR.getCode(), ex.getCode());
            verify(skillPermissionChecker, never()).resolvePermissionCodes(anyLong());
        }
    }
}
