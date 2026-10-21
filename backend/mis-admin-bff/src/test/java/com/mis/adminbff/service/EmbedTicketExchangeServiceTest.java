package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.model.IamRoleVO;
import com.mis.adminbff.client.model.IamUserVO;
import com.mis.adminbff.config.EmbedIdentityProperties;
import com.mis.adminbff.config.EmbedIdentityProperties.TicketHostConfig;
import com.mis.adminbff.dto.embed.EmbedExchangeResponse;
import com.mis.adminbff.dto.embed.EmbedTicketExchangeRequest;
import com.mis.adminbff.embed.AgentExternalHost;
import com.mis.adminbff.embed.AgentExternalMapper;
import com.mis.adminbff.security.SkillPermissionChecker;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.adminbff.support.embed.EmbedExchangeRateLimiter;
import com.mis.adminbff.support.embed.ExternalTokenVerifier;
import com.mis.adminbff.support.embed.seeyon.SeeyonTicketClient;
import com.mis.adminbff.support.embed.ticket.ExternalTicketIdentity;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.security.jwt.IssuedAccessToken;
import com.mis.common.security.jwt.JwtIssuer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.beans.factory.ObjectProvider;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EmbedTicketExchangeServiceTest {

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
    @Mock
    private SeeyonTicketClient seeyonTicketClient;

    private EmbedIdentityService service;

    private static final String HOST = "seeyon-a8";
    private static final String TICKET = "-6331871886887794391";
    private static final String PHONE = "13800138000";

    @BeforeEach
    void setUp() {
        service = new EmbedIdentityService(
                properties, mapper, iamWebClient, skillPermissionChecker,
                tokenVerifier, rateLimiter, jwtIssuerProvider, seeyonTicketClient);
        lenient().when(properties.getSalt()).thenReturn("test-salt");
        lenient().when(properties.isPhoneMatchEnabled()).thenReturn(true);
        lenient().when(jwtIssuerProvider.getIfAvailable()).thenReturn(jwtIssuer);
        lenient().when(jwtIssuer.issue(any())).thenReturn(new IssuedAccessToken("mis-jwt", "jti-1", 1800));
        lenient().when(skillPermissionChecker.resolvePermissionCodes(any(Long.class)))
                .thenReturn(Set.of("agent:chat:use"));
    }

    private AgentExternalHost host() {
        return new AgentExternalHost(HOST, "Seeyon", "seeyon-client", "hash",
                null, "active", 1L, "[]");
    }

    private TicketHostConfig ticketConfig() {
        TicketHostConfig c = new TicketHostConfig();
        c.setProvider("seeyon");
        c.setBaseUrl("http://oa.example.com");
        c.setRestUsername("rest");
        c.setRestPassword("secret");
        return c;
    }

    @Test
    @DisplayName("ticket + 手机号恰 1 条 → 签发 JWT mappedBy=phone")
    void ticketPhoneMatch() {
        when(mapper.findHost(HOST)).thenReturn(Optional.of(host()));
        Map<String, TicketHostConfig> map = new LinkedHashMap<>();
        map.put(HOST, ticketConfig());
        when(properties.getTicketHosts()).thenReturn(map);
        when(seeyonTicketClient.resolve(eq(HOST), eq(TICKET), any()))
                .thenReturn(new ExternalTicketIdentity("zhangsan", "zhangsan", "1", PHONE, "张三"));
        when(mapper.findIdentityMapping(HOST, "zhangsan")).thenReturn(Optional.empty());
        IamUserVO user = iamUser(42L);
        when(iamWebClient.findNormalUsersByPhone(1L, PHONE)).thenReturn(List.of(user));
        when(iamWebClient.getUser(42L)).thenReturn(user);

        EmbedExchangeResponse resp = service.exchangeByTicket(new EmbedTicketExchangeRequest(HOST, TICKET));
        assertEquals("mis-jwt", resp.misJwt());
        assertEquals("phone", resp.mappedBy());
        assertEquals("42", resp.mappedUserId());
    }

    private IamUserVO iamUser(long id) {
        return new IamUserVO(String.valueOf(id), "1", "92010", "1001", "oa-user", null, 1, null, null,
                "OA 用户", null, null, PHONE, null, null,
                List.of(new IamRoleVO("ROLE_1", "1", "92010", "user", "用户", null, null, null, null, null)),
                null, null);
    }

    @Test
    @DisplayName("ticket 宿主未配置 → 40102")
    void ticketHostNotConfigured() {
        when(mapper.findHost(HOST)).thenReturn(Optional.of(host()));
        when(properties.getTicketHosts()).thenReturn(Map.of());

        BusinessException ex = assertThrows(BusinessException.class,
                () -> service.exchangeByTicket(new EmbedTicketExchangeRequest(HOST, TICKET)));
        assertEquals(AgentOpsErrorCodes.EMBED_TICKET_INVALID, ex.getCode());
    }
}
