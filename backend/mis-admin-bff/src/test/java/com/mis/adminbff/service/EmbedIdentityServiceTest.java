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
import com.mis.common.security.jwt.IssuedAccessToken;
import com.mis.common.security.jwt.JwtIssuer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link EmbedIdentityService} 单测（D12 三级映射各分支 + 40101 + TTL 字段）。
 *
 * <p>覆盖 03 §7.3：E-01 显式映射 / E-02 手机号 =1 / E-03 手机号 >1 / E-04 手机号 =0 /
 * E-05 影子账号 / E-06 全未命中 / E-07 验签失败 40101 / E-12 P4 身份不受信（以 token 内为准）。
 */
@ExtendWith(MockitoExtension.class)
class EmbedIdentityServiceTest {

    @Mock
    private EmbedIdentityProperties properties;
    @Mock
    private AgentExternalMapper mapper;
    @Mock
    private IamWebClient iamWebClient;
    @Mock
    private SkillPermissionChecker skillPermissionChecker;
    @Mock
    private ExternalTokenVerifier tokenVerifier;
    @Mock
    private EmbedExchangeRateLimiter rateLimiter;
    @Mock
    private ObjectProvider<JwtIssuer> jwtIssuerProvider;
    @Mock
    private JwtIssuer jwtIssuer;

    private EmbedIdentityService service;

    private static final String HOST = "crm-web";
    private static final String SECRET = "host-secret";
    private static final String EXTERNAL_USER = "crm-00123";
    private static final String PHONE = "13800138000";

    @BeforeEach
    void setUp() throws Exception {
        service = new EmbedIdentityService(
                properties, mapper, iamWebClient, skillPermissionChecker,
                tokenVerifier, rateLimiter, jwtIssuerProvider);
        lenient().when(properties.getSalt()).thenReturn("test-salt");
        lenient().when(properties.isPhoneMatchEnabled()).thenReturn(true);
        lenient().when(jwtIssuerProvider.getIfAvailable()).thenReturn(jwtIssuer);
        lenient().when(jwtIssuer.issue(any())).thenReturn(new IssuedAccessToken("mis-jwt", "jti-1", 1800));
        lenient().when(skillPermissionChecker.resolvePermissionCodes(any(Long.class)))
                .thenReturn(Set.of("agent:chat:use", "approval:view"));
    }

    private AgentExternalHost host(String shadowUserId, Long tenantId) {
        // clientSecretHash 必须与配置的 SECRET 配对（服务层做 sha256 交叉校验，不配对即 40101）
        return new AgentExternalHost(HOST, "CRM", "crm-client", PhoneHash.sha256Hex(SECRET),
                shadowUserId, "active", tenantId, "[\"https://crm.example.com\"]");
    }

    private AgentExternalIdentity mapping(Long misUserId) {
        return new AgentExternalIdentity(HOST, EXTERNAL_USER, null, misUserId, "phone-hash", "active");
    }

    private ExternalTokenClaims claims(String externalUserId, String phone) {
        return new ExternalTokenClaims(HOST, HOST, externalUserId, phone, System.currentTimeMillis() / 1000 + 300);
    }

    private EmbedExchangeRequest request() {
        return new EmbedExchangeRequest(HOST, "signed-token", EXTERNAL_USER, PHONE, null);
    }

    private IamUserVO iamUser(long id, String tenantId) {
        return new IamUserVO(String.valueOf(id), tenantId, "92010", "1001", "crm-user", null, 1, null, null,
                "CRM 用户", null, null, PHONE, null, null,
                List.of(new IamRoleVO("ROLE_1", tenantId, "92010", "crm-role", "CRM 角色", null, null, null, null, null)),
                null, null);
    }

    // ============================================================================
    // E-07：验签失败 40101
    // ============================================================================

    @Nested
    @DisplayName("验签与宿主校验（40101）")
    class TokenVerification {

        @Test
        @DisplayName("E-07 外部 token 验签失败 → 40101 EMBED_TOKEN_INVALID")
        void invalidToken() throws Exception {
            when(mapper.findHost(HOST)).thenReturn(Optional.of(host("shadow-1", 1L)));
            when(properties.getClientSecrets()).thenReturn(java.util.Map.of(HOST, SECRET));
            when(tokenVerifier.verify(anyString(), anyString(), anyString()))
                    .thenThrow(new ExternalTokenVerifier.InvalidExternalTokenException("bad signature"));

            BusinessException ex = assertThrows(BusinessException.class, () -> service.exchange(request()));
            assertEquals(AgentOpsErrorCodes.EMBED_TOKEN_INVALID, ex.getCode());
            verify(mapper, never()).findIdentityMapping(anyString(), anyString());
        }

        @Test
        @DisplayName("host 未注册 → 40101")
        void hostNotRegistered() {
            when(mapper.findHost(HOST)).thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class, () -> service.exchange(request()));
            assertEquals(AgentOpsErrorCodes.EMBED_TOKEN_INVALID, ex.getCode());
        }

        @Test
        @DisplayName("client_secret 未配置 → 40101（无法验签，fail-closed）")
        void secretNotConfigured() throws Exception {
            when(mapper.findHost(HOST)).thenReturn(Optional.of(host(null, 1L)));
            when(properties.getClientSecrets()).thenReturn(java.util.Map.of());

            BusinessException ex = assertThrows(BusinessException.class, () -> service.exchange(request()));
            assertEquals(AgentOpsErrorCodes.EMBED_TOKEN_INVALID, ex.getCode());
            verify(tokenVerifier, never()).verify(anyString(), anyString(), anyString());
        }
    }

    // ============================================================================
    // E-01：显式映射
    // ============================================================================

    @Nested
    @DisplayName("三级映射：显式表 → 手机号 → 影子账号")
    class Mapping {

        @BeforeEach
        void seed() throws Exception {
            lenient().when(properties.getClientSecrets()).thenReturn(java.util.Map.of(HOST, SECRET));
            lenient().when(iamWebClient.getUser(5001L)).thenReturn(iamUser(5001L, "1"));
            lenient().when(tokenVerifier.verify(anyString(), anyString(), anyString()))
                    .thenReturn(claims(EXTERNAL_USER, PHONE));
        }

        @Test
        @DisplayName("E-01 显式映射命中 → mappedBy=explicit")
        void explicitMapping() {
            when(mapper.findHost(HOST)).thenReturn(Optional.of(host("shadow-1", 1L)));
            when(mapper.findIdentityMapping(HOST, EXTERNAL_USER)).thenReturn(Optional.of(mapping(5001L)));

            EmbedExchangeResponse response = service.exchange(request());

            assertEquals("explicit", response.mappedBy());
            assertEquals("5001", response.mappedUserId());
            assertEquals(1800, response.expiresIn());
            assertEquals("mis-jwt", response.misJwt());
            assertEquals(List.of("agent:chat:use", "approval:view"), response.permissions());
            // E-02 分支不应触发：显式命中后不做手机号匹配
            verify(iamWebClient, never()).findNormalUsersByPhone(any(), anyString());
        }

        @Test
        @DisplayName("E-02 手机号匹配 =1 正常状态账号 → mappedBy=phone（不进入影子账号）")
        void phoneSingleHit() {
            when(mapper.findHost(HOST)).thenReturn(Optional.of(host("shadow-1", 1L)));
            when(mapper.findIdentityMapping(HOST, EXTERNAL_USER)).thenReturn(Optional.empty());
            when(iamWebClient.findNormalUsersByPhone(1L, PHONE)).thenReturn(List.of(iamUser(6002L, "1")));
            when(iamWebClient.getUser(6002L)).thenReturn(iamUser(6002L, "1"));

            EmbedExchangeResponse response = service.exchange(request());

            assertEquals("phone", response.mappedBy());
            assertEquals("6002", response.mappedUserId());
            // 手机号命中优先级高于影子账号（03 §5.2）
            verify(iamWebClient, never()).getUser(eq(9999L));
        }

        @Test
        @DisplayName("E-03 手机号匹配 >1 正常状态账号 → 40301（歧义兜底，不区分提示，不进入影子回退）")
        void phoneAmbiguous() {
            when(mapper.findHost(HOST)).thenReturn(Optional.of(host("shadow-1", 1L)));
            when(mapper.findIdentityMapping(HOST, EXTERNAL_USER)).thenReturn(Optional.empty());
            when(iamWebClient.findNormalUsersByPhone(1L, PHONE))
                    .thenReturn(List.of(iamUser(1L, "1"), iamUser(2L, "1")));

            BusinessException ex = assertThrows(BusinessException.class, () -> service.exchange(request()));
            assertEquals(AgentOpsErrorCodes.SKILL_FORBIDDEN, ex.getCode());
            // 歧义不进入影子账号回退（用户拍板：不降级）
            verify(iamWebClient, never()).getUser(any(Long.class));
        }

        @Test
        @DisplayName("E-04 手机号匹配 =0（查无/全停用）→ 40301，不进入影子回退")
        void phoneNotFound() {
            when(mapper.findHost(HOST)).thenReturn(Optional.of(host("shadow-1", 1L)));
            when(mapper.findIdentityMapping(HOST, EXTERNAL_USER)).thenReturn(Optional.empty());
            when(iamWebClient.findNormalUsersByPhone(1L, PHONE)).thenReturn(List.of());

            BusinessException ex = assertThrows(BusinessException.class, () -> service.exchange(request()));
            assertEquals(AgentOpsErrorCodes.SKILL_FORBIDDEN, ex.getCode());
            verify(iamWebClient, never()).getUser(any(Long.class));
        }

        @Test
        @DisplayName("E-05 手机号未启用/无租户 → 跳过手机号匹配，影子账号兜底 mappedBy=shadow")
        void shadowFallbackWhenPhoneNotApplicable() {
            when(mapper.findHost(HOST)).thenReturn(Optional.of(host("7777", null))); // tenant_id 为空 → 跳过手机号
            when(mapper.findIdentityMapping(HOST, EXTERNAL_USER)).thenReturn(Optional.empty());
            when(iamWebClient.getUser(7777L)).thenReturn(iamUser(7777L, "1"));
            when(properties.isPhoneMatchEnabled()).thenReturn(true);

            EmbedExchangeResponse response = service.exchange(request());

            assertEquals("shadow", response.mappedBy());
            assertEquals("7777", response.mappedUserId());
            // 无 tenant_id 时不应发起手机号查询
            verify(iamWebClient, never()).findNormalUsersByPhone(any(), anyString());
        }

        @Test
        @DisplayName("E-06 全未命中（无映射/无手机号/无影子账号）→ 40301")
        void fullyUnmapped() {
            when(mapper.findHost(HOST)).thenReturn(Optional.of(host(null, null)));
            when(mapper.findIdentityMapping(HOST, EXTERNAL_USER)).thenReturn(Optional.empty());

            BusinessException ex = assertThrows(BusinessException.class, () -> service.exchange(request()));
            assertEquals(AgentOpsErrorCodes.SKILL_FORBIDDEN, ex.getCode());
        }

        @Test
        @DisplayName("E-12 P4：externalUserId/phone 以 token 内为准，忽略请求体冗余字段")
        void tokenClaimsWinOverBody() throws Exception {
            when(mapper.findHost(HOST)).thenReturn(Optional.of(host(null, 1L)));
            when(tokenVerifier.verify(anyString(), anyString(), anyString()))
                    .thenReturn(claims("token-user-id", "13900139000")); // token 内身份
            when(mapper.findIdentityMapping(HOST, "token-user-id"))
                    .thenReturn(Optional.of(new AgentExternalIdentity(HOST, "token-user-id", null, 5001L, null, "active")));
            when(iamWebClient.getUser(5001L)).thenReturn(iamUser(5001L, "1"));

            // 请求体携带伪造 externalUserId/phone，服务端只用 token 内值
            EmbedExchangeResponse response = service.exchange(
                    new EmbedExchangeRequest(HOST, "signed-token", "forged-user", "19999999999", null));

            assertEquals("explicit", response.mappedBy());
            verify(mapper).findIdentityMapping(HOST, "token-user-id");
            verify(mapper, never()).findIdentityMapping(HOST, "forged-user");
        }
    }

    // ============================================================================
    // 权限源不可用 / JWT 未配置 → fail-closed
    // ============================================================================

    @Nested
    @DisplayName("fail-closed：权限源不可用 / JWT 未配置")
    class FailClosed {

        @BeforeEach
        void seed() throws Exception {
            lenient().when(properties.getClientSecrets()).thenReturn(java.util.Map.of(HOST, SECRET));
            lenient().when(mapper.findHost(HOST)).thenReturn(Optional.of(host("7777", 1L)));
            lenient().when(mapper.findIdentityMapping(HOST, EXTERNAL_USER)).thenReturn(Optional.empty());
            lenient().when(iamWebClient.findNormalUsersByPhone(1L, PHONE)).thenReturn(List.of(iamUser(6002L, "1")));
            lenient().when(iamWebClient.getUser(6002L)).thenReturn(iamUser(6002L, "1"));
            lenient().when(tokenVerifier.verify(anyString(), anyString(), anyString()))
                    .thenReturn(claims(EXTERNAL_USER, PHONE));
        }

        @Test
        @DisplayName("权限源不可用 → 40303 ACL_UNAVAILABLE（绝不签发无权限的 token）")
        void permissionSourceUnavailable() {
            when(skillPermissionChecker.resolvePermissionCodes(6002L))
                    .thenThrow(new BusinessException(AgentOpsErrorCodes.ACL_UNAVAILABLE, "权限源不可用"));

            BusinessException ex = assertThrows(BusinessException.class, () -> service.exchange(request()));
            assertEquals(AgentOpsErrorCodes.ACL_UNAVAILABLE, ex.getCode());
            verify(jwtIssuer, never()).issue(any());
        }

        @Test
        @DisplayName("JWT 私钥未配置 → 40303 fail-closed")
        void jwtIssuerNotConfigured() {
            when(jwtIssuerProvider.getIfAvailable()).thenReturn(null);

            BusinessException ex = assertThrows(BusinessException.class, () -> service.exchange(request()));
            assertEquals(AgentOpsErrorCodes.ACL_UNAVAILABLE, ex.getCode());
        }
    }
}
