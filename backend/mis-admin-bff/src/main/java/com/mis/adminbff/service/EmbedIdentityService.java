package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.config.EmbedIdentityProperties;
import com.mis.adminbff.dto.embed.EmbedExchangeRequest;
import com.mis.adminbff.dto.embed.EmbedExchangeResponse;
import com.mis.adminbff.embed.AgentExternalHost;
import com.mis.adminbff.embed.AgentExternalIdentity;
import com.mis.adminbff.embed.AgentExternalMapper;
import com.mis.adminbff.security.SkillPermissionChecker;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.adminbff.support.embed.EmbedExchangeRateLimiter;
import com.mis.adminbff.support.embed.ExternalTokenClaims;
import com.mis.adminbff.support.embed.ExternalTokenVerifier;
import com.mis.adminbff.support.embed.PhoneHash;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.jwt.AccessTokenClaims;
import com.mis.common.security.jwt.IssuedAccessToken;
import com.mis.common.security.jwt.JwtIssuer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * D12 嵌入身份兑换编排（03-permission-design §5 权限视角 + R1-R6 红线）。
 *
 * <p><b>三级映射回退</b>（01-architecture §4.4）：
 * <ol>
 *   <li><b>显式映射表</b>（细粒度）：{@code agent_external_identity}
 *       （hostId + externalUserId → misUserId）命中即映射；</li>
 *   <li><b>手机号匹配</b>（无表可查时）：token 内 phone 反查 MIS 正常状态账号，
 *       用户拍板规则：=1 映射该用户；>1 一律 40301；=0 同样 40301；
 *       <b>不进入影子账号回退</b>（02 §4.6 / 03 §5.2）；</li>
 *   <li><b>影子账号</b>（粗粒度默认）：host 配置 {@code shadow_mis_user_id} 时使用；</li>
 * </ol>
 * 任一级未命中 / 歧义 → 40301 零权限（fail-closed，不区分提示防枚举）。
 *
 * <p><b>安全红线落点</b>：
 * <ul>
 *   <li>R1：先验签（HS256 client_secret）才允许手机号参与匹配；</li>
 *   <li>R2/R3：phone_hash 只作存储/日志维度，日志只记脱敏号与 hash；</li>
 *   <li>R4：歧义/查无一律 40301 且不区分提示；</li>
 *   <li>R6：按 hostId + clientId 限流 + 审计（hostId + externalUserId + mappedBy + 脱敏号）。</li>
 * </ul>
 */
@Service
public class EmbedIdentityService {

    private static final Logger log = LoggerFactory.getLogger(EmbedIdentityService.class);

    private final EmbedIdentityProperties properties;
    private final AgentExternalMapper mapper;
    private final IamWebClient iamWebClient;
    private final SkillPermissionChecker skillPermissionChecker;
    private final ExternalTokenVerifier tokenVerifier;
    private final EmbedExchangeRateLimiter rateLimiter;
    private final ObjectProvider<JwtIssuer> jwtIssuerProvider;

    public EmbedIdentityService(
            EmbedIdentityProperties properties,
            AgentExternalMapper mapper,
            IamWebClient iamWebClient,
            SkillPermissionChecker skillPermissionChecker,
            ExternalTokenVerifier tokenVerifier,
            EmbedExchangeRateLimiter rateLimiter,
            ObjectProvider<JwtIssuer> jwtIssuerProvider) {
        this.properties = properties;
        this.mapper = mapper;
        this.iamWebClient = iamWebClient;
        this.skillPermissionChecker = skillPermissionChecker;
        this.tokenVerifier = tokenVerifier;
        this.rateLimiter = rateLimiter;
        this.jwtIssuerProvider = jwtIssuerProvider;
    }

    /**
     * 兑换入口：验签 → 三级映射 → 签发 RS256 MIS JWT → 返回响应。
     *
     * @param request 兑换请求
     * @return 兑换响应（misJwt / expiresIn / mappedUserId / mappedBy / permissions）
     */
    public EmbedExchangeResponse exchange(EmbedExchangeRequest request) {
        String hostId = request.hostId() == null ? "" : request.hostId().trim();
        if (hostId.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少 hostId");
        }
        if (request.externalToken() == null || request.externalToken().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少 externalToken");
        }

        // ① 宿主注册校验 + ② 验签密钥交叉校验（fail-closed）
        AgentExternalHost host = mapper.findHost(hostId)
                .orElseThrow(() -> reject(hostId, null, "host_not_registered"));
        if (!host.isActive()) {
            throw reject(hostId, host.clientId(), "host_inactive");
        }

        // 验签密钥来自配置；与注册表 client_secret_hash 一致性交叉校验
        String clientSecret = properties.getClientSecrets().get(hostId);
        if (clientSecret == null || clientSecret.isBlank()) {
            log.error("宿主 client_secret 未配置: hostId={}", hostId);
            throw reject(hostId, host.clientId(), "secret_not_configured");
        }
        if (host.clientSecretHash() != null && !host.clientSecretHash().isBlank()
                && !PhoneHash.sha256Hex(clientSecret).equalsIgnoreCase(host.clientSecretHash())) {
            log.error("宿主 client_secret 与注册哈希不一致: hostId={}", hostId);
            throw reject(hostId, host.clientId(), "secret_hash_mismatch");
        }

        // R6：兑换限流（hostId + clientId）
        rateLimiter.assertAllowed(hostId, host.clientId());

        // ③ externalToken 验签（HS256，P4：只信 token 内身份）
        ExternalTokenClaims claims;
        try {
            claims = tokenVerifier.verify(request.externalToken(), clientSecret, hostId);
        } catch (ExternalTokenVerifier.InvalidExternalTokenException ex) {
            audit(hostId, host.clientId(), null, "invalid_token", null);
            throw reject(hostId, host.clientId(), "invalid_token");
        }

        String externalUserId = claims.externalUserId();
        String phone = claims.phone();
        String phoneHash = PhoneHash.hash(phone, properties.getSalt());

        // ④ 三级映射
        // 4.1 显式映射表（细粒度）
        AgentExternalIdentity mapping = mapper.findIdentityMapping(hostId, externalUserId).orElse(null);
        if (mapping != null && mapping.isActive()) {
            return finish(host, mapping.misUserId(), "explicit", externalUserId, phoneHash, request.scope());
        }

        // 4.2 手机号匹配（无表可查时；命中 =1 映射，>1/=0 一律 40301，不进入影子回退）
        if (properties.isPhoneMatchEnabled() && phone != null && !phone.isBlank() && host.tenantId() != null) {
            List<IamUserVO> users = iamWebClient.findNormalUsersByPhone(host.tenantId(), phone);
            if (users.size() > 1) {
                audit(hostId, externalUserId, phoneHash, "phone_ambiguous", null);
                throw reject(hostId, externalUserId, "phone_ambiguous");
            }
            if (users.size() == 1) {
                IamUserVO user = users.get(0);
                return finish(host, parseUserId(user.id()), "phone", externalUserId, phoneHash, request.scope());
            }
            // =0（查无/全部停用/未绑定）→ 同样 40301，且不进入影子账号回退
            audit(hostId, externalUserId, phoneHash, "phone_not_found", null);
            throw reject(hostId, externalUserId, "phone_not_found");
        }

        // 4.3 影子账号（粗粒度默认；host 未配置则兜底 40301）
        if (host.shadowMisUserId() != null && !host.shadowMisUserId().isBlank()) {
            return finish(host, parseUserId(host.shadowMisUserId()), "shadow", externalUserId, phoneHash, request.scope());
        }

        audit(hostId, externalUserId, phoneHash, "unmapped", null);
        throw reject(hostId, externalUserId, "unmapped");
    }

    // ============================================================================
    // 内部：签发 + 权限 + 审计
    // ============================================================================

    /**
     * 映射命中后的公共收尾：加载用户资料 → 签发 RS256 MIS JWT → 解析权限码 →
     * 影子账号 scope 校验 → 审计 → 响应。
     */
    private EmbedExchangeResponse finish(
            AgentExternalHost host,
            Long misUserId,
            String mappedBy,
            String externalUserId,
            String phoneHash,
            List<String> scope) {
        if (misUserId == null) {
            audit(host.hostId(), externalUserId, phoneHash, mappedBy + "_no_user", null);
            throw reject(host.hostId(), externalUserId, "mapped_user_missing");
        }

        // 加载映射用户资料（签发载荷需要 username/roles/tenantId 等）
        IamUserVO user;
        try {
            user = iamWebClient.getUser(misUserId);
        } catch (BusinessException ex) {
            // 404 视为映射失效（fail-closed）；权限源/下游故障同样拒绝
            audit(host.hostId(), externalUserId, phoneHash, mappedBy + "_user_load_failed", null);
            throw reject(host.hostId(), externalUserId, "mapped_user_unavailable");
        }
        if (user == null) {
            throw reject(host.hostId(), externalUserId, "mapped_user_missing");
        }

        // 解析权限码（与 /internal/permissions 同源；源不可用 → 40303 fail-closed）
        Set<String> permissions;
        try {
            permissions = skillPermissionChecker.resolvePermissionCodes(misUserId);
        } catch (BusinessException ex) {
            if (ex.getCode() == AgentOpsErrorCodes.ACL_UNAVAILABLE) {
                throw ex; // 权限源不可用，fail-closed
            }
            throw reject(host.hostId(), externalUserId, "permission_resolve_failed");
        }
        List<String> permissionList = permissions == null ? List.of() : new ArrayList<>(permissions);
        permissionList.sort(String::compareTo);

        // 影子账号：scope ⊆ 权限码（服务端强制，03 §5.5）
        if ("shadow".equals(mappedBy) && scope != null && !scope.isEmpty()) {
            for (String code : scope) {
                if (code != null && !code.isBlank() && !permissions.contains(code)) {
                    audit(host.hostId(), externalUserId, phoneHash, "shadow_scope_rejected", null);
                    throw reject(host.hostId(), externalUserId, "shadow_scope_rejected");
                }
            }
        }

        // 签发短时 RS256 MIS JWT（与现有登录链路同签名体系；私钥未配置 → 40303 fail-closed）
        JwtIssuer jwtIssuer = jwtIssuerProvider.getIfAvailable();
        if (jwtIssuer == null) {
            log.error("MIS JWT 私钥未配置（mis.security.jwt.private-key-path），无法签发嵌入令牌: hostId={}",
                    host.hostId());
            throw new BusinessException(AgentOpsErrorCodes.ACL_UNAVAILABLE, "JWT 签发能力未配置");
        }

        AccessTokenClaims claims = new AccessTokenClaims(
                misUserId,
                parseLongSafe(user.tenantId(), 0L),
                parseLongSafe(user.appId(), 0L),
                parseLongSafe(user.employeeId(), 0L),
                user.username() == null ? "" : user.username(),
                roleCodes(user),
                0L);
        IssuedAccessToken issued = jwtIssuer.issue(claims);

        audit(host.hostId(), externalUserId, phoneHash, mappedBy, misUserId);
        return new EmbedExchangeResponse(
                issued.token(),
                issued.expiresInSeconds(),
                String.valueOf(misUserId),
                mappedBy,
                permissionList);
    }

    /** 角色码列表（签发载荷 roles；null → 空列表） */
    private static List<String> roleCodes(IamUserVO user) {
        if (user.roles() == null) {
            return List.of();
        }
        List<String> codes = new ArrayList<>();
        for (IamRoleVO role : user.roles()) {
            if (role != null && role.code() != null && !role.code().isBlank()) {
                codes.add(role.code());
            }
        }
        return codes;
    }

    /** 字符串 userId → Long；非法返回 null（由调用方 fail-closed） */
    private static Long parseUserId(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Long.valueOf(raw.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    private static long parseLongSafe(String raw, long defaultValue) {
        Long parsed = raw == null || raw.isBlank() ? null : parseLong(raw);
        return parsed != null ? parsed : defaultValue;
    }

    private static Long parseLong(String raw) {
        try {
            return Long.valueOf(raw.trim());
        } catch (NumberFormatException ex) {
            return null;
        }
    }

    /** 拒绝统一出口：40101 或 40301，日志留痕，响应不区分提示（R4）。 */
    private static BusinessException reject(String hostId, String externalUserId, String reason) {
        // 日志记 hash/脱敏维度，不落明文；reason 面向运维
        log.warn("嵌入身份兑换被拒绝: hostId={}, externalUserId={}, reason={}",
                hostId, maskExternalUserId(externalUserId), reason);
        // invalid_token / host 注册问题 → 40101（身份不可信）；映射失败 → 40301（身份合法但无映射）
        boolean identityInvalid = "host_not_registered".equals(reason)
                || "host_inactive".equals(reason)
                || "secret_not_configured".equals(reason)
                || "secret_hash_mismatch".equals(reason)
                || "invalid_token".equals(reason);
        if (identityInvalid) {
            return new BusinessException(AgentOpsErrorCodes.EMBED_TOKEN_INVALID, "外部身份令牌无效");
        }
        // 其余（映射未命中/歧义/影子未配）→ 40301 零权限，不区分提示
        return new BusinessException(AgentOpsErrorCodes.SKILL_FORBIDDEN, "外部身份未映射，零权限");
    }

    /** 审计日志（R6：hostId + externalUserId + mappedBy + 脱敏号/hash；R3 不落明文手机号）。 */
    private static void audit(
            String hostId,
            String externalUserId,
            String phoneHash,
            String outcome,
            Long mappedUserId) {
        log.info("embed identity exchange audit: hostId={}, externalUserId={}, phoneHash={}, "
                        + "outcome={}, mappedUserId={}",
                hostId,
                maskExternalUserId(externalUserId),
                phoneHash == null ? "" : phoneHash,
                outcome,
                mappedUserId == null ? "" : mappedUserId);
    }

    /** 外部用户标识脱敏（防枚举留痕；仅日志维度）。 */
    private static String maskExternalUserId(String externalUserId) {
        if (externalUserId == null || externalUserId.isBlank()) {
            return "";
        }
        if (externalUserId.length() <= 4) {
            return "****";
        }
        return externalUserId.substring(0, 2) + "****" + externalUserId.substring(externalUserId.length() - 2);
    }
}
