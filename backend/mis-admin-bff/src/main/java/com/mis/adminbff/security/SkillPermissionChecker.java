package com.mis.adminbff.security;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.dto.agentops.SkillGrantVO;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.security.context.LoginUser;
import com.mis.common.security.context.SecurityContextHolder;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * E6 权限闸门（fail-closed）。
 *
 * <p>由 {@code AiProxyController} 的 {@code /skill/execute} 与 {@code /skill/apply} 两个端点在
 * 方法体内<b>同步</b>调用（非拦截器 / 非 AOP：SSE / Flux 二次进入时
 * {@code LoginUser} 已被 {@code GatewayContextFilter} 清空，拦截器在 ASYNC 派发下会被跳过）。
 *
 * <p><b>来路分支</b>：优先取 {@link ReverseTrustInterceptor} 经反向信任解析出的
 * {@link ReverseTrustContext}。其 {@code fromUpstreamJwt()} 为 {@code true} 时，
 * {@code userId()} 为 MIS JWT 的 {@code sub}（真正的 MIS userId），方可用于判权；
 * 为 {@code false}（X-User-Id 降级支，头里实际是 employeeId）时<b>必须立即拒绝且不回源</b>，
 * 否则会拿 employeeId 去 {@code loadPermissions} 命中他人权限集 ⇒ 横向越权。
 *
 * <p><b>直连支</b>：取网关登录用户 {@code SecurityContextHolder} 的 userId。
 *
 * <p><b>缓存纪律</b>：独占 {@code mis:acl:skillperm:{userId}}（TTL 60s），
 * 严禁复用 {@code CacheConstants.RBAC_PERMISSIONS}（那是 tenantId+appId+userId 三元组、被
 * {@code UserPermissionLoader} 语义占用，且反向信任支拿不到 appId）。
 */
@Component
public class SkillPermissionChecker {

    private static final Logger log = LoggerFactory.getLogger(SkillPermissionChecker.class);
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() {};
    private static final String CACHE_PREFIX = "mis:acl:skillperm:";
    private static final Duration CACHE_TTL = Duration.ofSeconds(60);

    private final IamWebClient iamWebClient;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final Set<String> superadminBypassRoleCodes;

    public SkillPermissionChecker(
            IamWebClient iamWebClient,
            StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper,
            @Value("${acl.superadminBypassRoleCodes:}") String rawSuperadminBypassRoleCodes) {
        this.iamWebClient = iamWebClient;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.superadminBypassRoleCodes = parseRoleCodes(rawSuperadminBypassRoleCodes);
    }

    /**
     * 判定当前请求是否有权执行指定技能；无权则抛出 {@link BusinessException}
     * （全局处理器封成 HTTP 200 + body.code=40301 / 40303）。
     */
    public void assertCanRun(HttpServletRequest request, String skillId) {
        LoginUser loginUser = SecurityContextHolder.getOptional().orElse(null);

        Long userId;
        Object attr = request.getAttribute(ReverseTrustInterceptor.ATTRIBUTE_NAME);
        if (attr instanceof ReverseTrustContext ctx) {
            // 反向信任支
            if (!ctx.fromUpstreamJwt()) {
                // 降级支：X-User-Id 头携带的是 employeeId（非 MIS userId）。
                // 用之去 loadPermissions 会命中他人权限集 ⇒ 横向越权。
                // 关键不变量：此路径下 iamWebClient.loadPermissions 调用次数必须为 0。
                throw new BusinessException(
                        AgentOpsErrorCodes.SKILL_FORBIDDEN,
                        "反向信任降级链路无权执行技能",
                        Map.of("code", "AI_SKILL_FORBIDDEN",
                               "reason", "reverse_trust_degraded_no_jwt"));
            }
            userId = ctx.userId();
        } else {
            // 直连支（mis-admin-web 网关登录用户）；超管角色豁免（默认空集合 ⇒ 不触发）
            if (isSuperadminBypass(loginUser)) {
                return;
            }
            if (loginUser == null || loginUser.getUserId() == null) {
                throw new BusinessException(
                        AgentOpsErrorCodes.ACL_UNAVAILABLE,
                        "无法解析登录用户身份",
                        Map.of("code", "AI_ACL_UNAVAILABLE", "reason", "no_login_user"));
            }
            userId = loginUser.getUserId();
        }

        // 权限码与注册侧 SkillPermissionCodeService.ensureCode 保持一致：先 trim 再拼码，
        // 否则请求体里偶发的前后空白会让 required 与 sys_menu 中已落库的码对不上 ⇒ 误拒。
        String requiredPermission =
                SkillGrantVO.permissionCodeOf(skillId == null ? "" : skillId.trim());
        Set<String> perms = loadPermissions(userId);
        if (perms == null || perms.isEmpty() || !perms.contains(requiredPermission)) {
            if (perms != null && perms.isEmpty()) {
                // 下游 body 为 null 时会静默返空集，可能把"源结构异常"误判成"无权限"，留痕便于排查。
                log.warn("技能权限集为空，按无权限拒绝: userId={}, skillId={}, required={}",
                        userId, skillId, requiredPermission);
            }
            throw new BusinessException(
                    AgentOpsErrorCodes.SKILL_FORBIDDEN,
                    "无权执行技能 " + skillId,
                    Map.of("code", "AI_SKILL_FORBIDDEN",
                           "skillId", skillId,
                           "requiredPermission", requiredPermission));
        }
    }

    private boolean isSuperadminBypass(LoginUser user) {
        if (superadminBypassRoleCodes.isEmpty() || user == null) {
            return false;
        }
        Set<String> roles = user.getRoles();
        return roles != null && !Collections.disjoint(roles, superadminBypassRoleCodes);
    }

    /**
     * 统一取码（两支路共用同一链路）：先读缓存（含空集，防穿透），未命中再回源。
     * 异常路径绝不写缓存；空集也要写，防穿透。
     */
    private Set<String> loadPermissions(Long userId) {
        String key = CACHE_PREFIX + userId;
        Set<String> cached = readCache(key);
        if (cached != null) {
            return cached;
        }
        try {
            List<String> list = iamWebClient.loadPermissions(userId);
            Set<String> perms = list == null ? Set.of() : new LinkedHashSet<>(list);
            writeCache(key, perms);
            return perms;
        } catch (BusinessException ex) {
            if (ex.getCode() == 40400) {
                // 用户不存在 ⇒ 视作无权限
                throw new BusinessException(
                        AgentOpsErrorCodes.SKILL_FORBIDDEN,
                        "用户无技能执行权限",
                        Map.of("code", "AI_SKILL_FORBIDDEN", "reason", "user_not_found"));
            }
            // 超时 / 连接拒绝 / 非 2xx / 无响应 ⇒ 权限源不可用，fail-closed
            throw new BusinessException(
                    AgentOpsErrorCodes.ACL_UNAVAILABLE,
                    "权限源不可用",
                    Map.of("code", "AI_ACL_UNAVAILABLE", "reason", "iam_unavailable"));
        }
    }

    private Set<String> readCache(String key) {
        String json = redisTemplate.opsForValue().get(key);
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            List<String> list = objectMapper.readValue(json, STRING_LIST);
            return list == null ? Collections.emptySet() : new LinkedHashSet<>(list);
        } catch (JsonProcessingException ex) {
            log.warn("反序列化技能权限缓存失败: key={}", key, ex);
            return null;
        }
    }

    private void writeCache(String key, Set<String> perms) {
        try {
            redisTemplate.opsForValue().set(key, objectMapper.writeValueAsString(perms), CACHE_TTL);
        } catch (JsonProcessingException ex) {
            log.warn("序列化技能权限缓存失败: key={}", key, ex);
        }
    }

    private static Set<String> parseRoleCodes(String raw) {
        if (raw == null || raw.isBlank()) {
            return Set.of();
        }
        return Arrays.stream(raw.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toUnmodifiableSet());
    }
}
