package com.mis.adminbff.controller;

import com.mis.adminbff.dto.internal.InternalPermissionsVO;
import com.mis.adminbff.security.SkillPermissionChecker;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.Result;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 服务间权限码查询端点（ai-platform T03 fail-closed 权限闸门的权限源）。
 *
 * <p><b>它为什么存在</b>：ai-platform 的
 * {@code MisPermissionResolver._fetch_from_bff} 一直在调
 * {@code GET {MIS_ADMIN_BFF_BASE_URL}/internal/permissions?userId=}，
 * 而 BFF 侧从未实现过这个路由。回源必然失败 ⇒ 抛 {@code PermissionUnavailable}
 * ⇒ {@code SkillAclGuard} 按最小权限原则拒绝<b>每一次</b> skill / MCP 工具执行，
 * 用户看到的就是「权限服务暂不可用，已按最小权限原则拒绝执行」。
 *
 * <p><b>安全</b>：路径落在 {@code /internal/**} 之下，
 * 由 {@link com.mis.adminbff.security.InternalServiceTrustInterceptor} 强制校验
 * {@code X-Platform-Token} + 来源网段；且 {@code mis-gateway} 只把
 * {@code /api/v1/**} 路由到 BFF，本端点不经公网入口。
 *
 * <p><b>为什么不复用 {@code /api/v1/auth/me}</b>：那个端点取的是「当前登录用户」
 * （{@code RequestContext.requireLoginUser()}，依赖网关注入的上下文），
 * 而这里要查的是「任意指定 userId」；且它的响应字段是 {@code data.permissions}，
 * 与解析侧约定的 {@code data.codes} 不符。硬套会同时改坏两边。
 */
@RestController
@RequestMapping("/internal")
public class InternalPermissionController {

    private static final Logger log = LoggerFactory.getLogger(InternalPermissionController.class);

    private final SkillPermissionChecker skillPermissionChecker;

    public InternalPermissionController(SkillPermissionChecker skillPermissionChecker) {
        this.skillPermissionChecker = skillPermissionChecker;
    }

    /**
     * 查询指定用户的权限码集合。
     *
     * <p>取码链路与 BFF 自身的 E6 闸门 {@code SkillPermissionChecker.assertCanRun}
     * <b>完全同源</b>（同一份 {@code mis:acl:skillperm:{userId}} 缓存、同一个
     * {@code IamWebClient.loadPermissions} 回源），保证 Java 侧与 Python 侧对
     * 同一用户永远给出同一答案。
     *
     * <p><b>{@code appId} 目前只作日志维度、不参与过滤</b>：权限源
     * {@code mis-iam /internal/v1/permissions/{userId}} 本身就是按 userId 聚合的，
     * BFF 无法凭空按 appId 切分。这里如实接收并记录，而不是假装做了过滤——
     * 静默忽略比不接收更危险，将来若权限源支持了按应用维度取码，
     * 这个参数就是现成的接入点。
     *
     * @param userId MIS userId（必填，非 employeeId / 企微 userid）
     * @param appId  应用标识（可选，仅用于日志与将来扩展）
     * @return {@code {code:0, data:{userId, codes:[...]}}}
     * @throws BusinessException userId 非法（参数错误）/ 权限源不可用（fail-closed）
     */
    @GetMapping("/permissions")
    public Result<InternalPermissionsVO> permissions(
            @RequestParam("userId") String userId,
            @RequestParam(value = "appId", required = false) String appId) {
        Long parsedUserId = parseUserId(userId);

        Set<String> codes = skillPermissionChecker.resolvePermissionCodes(parsedUserId);
        List<String> sorted = new ArrayList<>(codes == null ? Set.<String>of() : codes);
        // 权限码原样保留（不 lower、不改写），仅做稳定排序便于比对；
        // 与 Python 侧 _parse_codes「逐字节一致」的约定必须守住。
        sorted.sort(String::compareTo);

        log.debug("内部权限码查询: userId={}, appId={}, count={}", parsedUserId, appId, sorted.size());
        return Result.ok(new InternalPermissionsVO(parsedUserId, sorted));
    }

    /**
     * 解析并校验 userId。
     *
     * <p>用 {@code String} 接参再手工解析，而不是直接声明 {@code Long}：
     * 后者遇到 {@code userId=abc} 会抛 {@code MethodArgumentTypeMismatchException}，
     * 经全局处理器落成 {@code 50000 系统错误}——把「调用方传错参」伪装成「BFF 坏了」，
     * 排查时会往完全错误的方向走。
     *
     * @param raw 原始查询参数
     * @return 解析后的 userId
     * @throws BusinessException 参数为空或非数字
     */
    private static Long parseUserId(String raw) {
        String trimmed = raw == null ? "" : raw.trim();
        if (trimmed.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少 userId");
        }
        try {
            return Long.valueOf(trimmed);
        } catch (NumberFormatException ex) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "非法的 userId: " + trimmed);
        }
    }
}
