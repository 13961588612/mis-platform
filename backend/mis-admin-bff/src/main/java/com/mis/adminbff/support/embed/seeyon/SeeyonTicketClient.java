package com.mis.adminbff.support.embed.seeyon;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.config.EmbedIdentityProperties.TicketHostConfig;
import com.mis.adminbff.support.AgentOpsErrorCodes;
import com.mis.adminbff.support.embed.ticket.ExternalTicketIdentity;
import com.mis.adminbff.support.embed.ticket.TicketFingerprint;
import com.mis.common.core.exception.BusinessException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.reactive.ReactorClientHttpConnector;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.web.reactive.function.client.WebClientRequestException;
import org.springframework.web.reactive.function.client.WebClientResponseException;
import io.netty.channel.ChannelOption;
import reactor.netty.http.client.HttpClient;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

/**
 * 致远 A8 ticket-pull 出站客户端。
 *
 * <ol>
 *   <li>GET {@code /seeyon/thirdpartyController.do?ticket=} → 响应头 LoginName / MemberId</li>
 *   <li>POST {@code /seeyon/rest/token} → REST token</li>
 *   <li>GET {@code /seeyon/rest/orgMember?loginName=} → telNumber</li>
 * </ol>
 *
 * <p>日志只记 ticket 指纹、耗时、HTTP 状态与关键头是否存在；不落 ticket 明文、REST 密码、手机号明文。
 *
 * <p>仅保留单一构造器，供 Spring 构造器注入（多构造器且无 {@code @Autowired} 时会落到无参构造并启动失败）。
 */
@Component
public class SeeyonTicketClient {

    private static final Logger log = LoggerFactory.getLogger(SeeyonTicketClient.class);

    private final ObjectMapper objectMapper;
    private final AtomicReference<CachedRestToken> cachedToken = new AtomicReference<>();

    public SeeyonTicketClient(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    /**
     * 验票并取手机号。
     *
     * @throws BusinessException 40102 验票失败；50301 上游不可达
     */
    public ExternalTicketIdentity resolve(String hostId, String ticket, TicketHostConfig config) {
        String fp = TicketFingerprint.of(ticket);
        long t0 = System.currentTimeMillis();
        log.info("seeyon ticket resolve start: hostId={}, ticketFp={}, baseUrl={}",
                hostId, fp, sanitizeBaseUrl(config.getBaseUrl()));

        HandshakeResult handshake = handshake(hostId, ticket, fp, config);
        String restToken = obtainRestToken(hostId, fp, config);
        MemberPhone member = fetchMemberPhone(hostId, fp, handshake.loginName(), restToken, config);

        String externalUserId = !isBlank(handshake.loginName())
                ? handshake.loginName()
                : handshake.memberId();
        if (isBlank(externalUserId)) {
            log.warn("seeyon ticket resolve fail: hostId={}, ticketFp={}, reason=no_external_user_id, elapsedMs={}",
                    hostId, fp, System.currentTimeMillis() - t0);
            throw new BusinessException(AgentOpsErrorCodes.EMBED_TICKET_INVALID, "外部 ticket 无效");
        }
        if (isBlank(member.telNumber())) {
            log.warn("seeyon ticket resolve fail: hostId={}, ticketFp={}, loginName={}, reason=no_tel_number, elapsedMs={}",
                    hostId, fp, maskLogin(handshake.loginName()), System.currentTimeMillis() - t0);
            throw new BusinessException(AgentOpsErrorCodes.EMBED_TICKET_INVALID, "外部 ticket 无效");
        }

        log.info("seeyon ticket resolve ok: hostId={}, ticketFp={}, loginName={}, memberIdPresent={}, "
                        + "phonePresent=true, elapsedMs={}",
                hostId, fp, maskLogin(handshake.loginName()),
                !isBlank(handshake.memberId()), System.currentTimeMillis() - t0);

        return new ExternalTicketIdentity(
                externalUserId.trim(),
                blankToNull(handshake.loginName()),
                blankToNull(handshake.memberId()),
                member.telNumber().trim(),
                blankToNull(member.name()));
    }

    private HandshakeResult handshake(String hostId, String ticket, String fp, TicketHostConfig config) {
        String base = trimSlash(config.getBaseUrl());
        long t0 = System.currentTimeMillis();
        log.info("seeyon handshake request: hostId={}, ticketFp={}, path=/seeyon/thirdpartyController.do",
                hostId, fp);
        try {
            WebClient client = buildClient(config);
            ResponseEntity<String> entity = client.get()
                    .uri(base + "/seeyon/thirdpartyController.do?ticket={ticket}", ticket)
                    .exchangeToMono(resp -> resp.toEntity(String.class))
                    .block(Duration.ofMillis(config.getReadTimeoutMs() + 1_000L));

            if (entity == null) {
                log.warn("seeyon handshake empty response: hostId={}, ticketFp={}, elapsedMs={}",
                        hostId, fp, System.currentTimeMillis() - t0);
                throw upstream(hostId, fp, "handshake_empty");
            }

            HttpHeaders headers = entity.getHeaders();
            String loginName = firstHeader(headers, "LoginName", "loginName", "loginname");
            String memberId = firstHeader(headers, "MemberId", "memberId", "memberid");
            String memberName = firstHeader(headers, "MemberName", "memberName", "membername");

            log.info("seeyon handshake response: hostId={}, ticketFp={}, httpStatus={}, "
                            + "hasLoginName={}, hasMemberId={}, hasMemberName={}, headerNames={}, elapsedMs={}",
                    hostId, fp, entity.getStatusCode().value(),
                    !isBlank(loginName), !isBlank(memberId), !isBlank(memberName),
                    headers.keySet(), System.currentTimeMillis() - t0);

            if (isBlank(loginName) && isBlank(memberId)) {
                log.warn("seeyon handshake missing identity headers: hostId={}, ticketFp={}", hostId, fp);
                throw new BusinessException(AgentOpsErrorCodes.EMBED_TICKET_INVALID, "外部 ticket 无效");
            }
            return new HandshakeResult(
                    blankToNull(loginName),
                    blankToNull(memberId),
                    blankToNull(memberName));
        } catch (BusinessException ex) {
            throw ex;
        } catch (WebClientResponseException ex) {
            log.warn("seeyon handshake http error: hostId={}, ticketFp={}, status={}, elapsedMs={}",
                    hostId, fp, ex.getStatusCode().value(), System.currentTimeMillis() - t0);
            throw new BusinessException(AgentOpsErrorCodes.EMBED_TICKET_INVALID, "外部 ticket 无效");
        } catch (WebClientRequestException | IllegalStateException ex) {
            log.warn("seeyon handshake upstream error: hostId={}, ticketFp={}, type={}, msg={}, elapsedMs={}",
                    hostId, fp, ex.getClass().getSimpleName(), safeMsg(ex), System.currentTimeMillis() - t0);
            throw upstream(hostId, fp, "handshake_upstream");
        } catch (Exception ex) {
            log.warn("seeyon handshake unexpected: hostId={}, ticketFp={}, type={}, msg={}, elapsedMs={}",
                    hostId, fp, ex.getClass().getSimpleName(), safeMsg(ex), System.currentTimeMillis() - t0);
            throw upstream(hostId, fp, "handshake_unexpected");
        }
    }

    private String obtainRestToken(String hostId, String fp, TicketHostConfig config) {
        CachedRestToken cached = cachedToken.get();
        long now = System.currentTimeMillis();
        // REST token 官方约 15min；缓存 10min 留余量
        if (cached != null
                && cached.hostId().equals(hostId)
                && cached.baseUrl().equals(config.getBaseUrl())
                && cached.expiresAtMs() > now + 30_000L) {
            log.debug("seeyon rest token cache hit: hostId={}, ticketFp={}", hostId, fp);
            return cached.token();
        }

        String url = trimSlash(config.getBaseUrl()) + "/seeyon/rest/token";
        long t0 = System.currentTimeMillis();
        log.info("seeyon rest/token request: hostId={}, ticketFp={}, user={}",
                hostId, fp, maskLogin(config.getRestUsername()));
        try {
            Map<String, String> body = new HashMap<>();
            body.put("userName", config.getRestUsername());
            body.put("password", config.getRestPassword());

            WebClient client = buildClient(config);
            String raw = client.post()
                    .uri(url)
                    .contentType(MediaType.APPLICATION_JSON)
                    .accept(MediaType.APPLICATION_JSON)
                    .bodyValue(body)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block(Duration.ofMillis(config.getReadTimeoutMs() + 1_000L));

            String tokenId = parseTokenId(raw);
            if (isBlank(tokenId) || "-1".equals(tokenId)) {
                log.warn("seeyon rest/token rejected: hostId={}, ticketFp={}, elapsedMs={}",
                        hostId, fp, System.currentTimeMillis() - t0);
                throw new BusinessException(AgentOpsErrorCodes.EMBED_TICKET_INVALID, "外部 ticket 无效");
            }

            cachedToken.set(new CachedRestToken(
                    hostId, config.getBaseUrl(), tokenId, now + 10 * 60_000L));
            log.info("seeyon rest/token ok: hostId={}, ticketFp={}, tokenFp={}, elapsedMs={}",
                    hostId, fp, TicketFingerprint.of(tokenId), System.currentTimeMillis() - t0);
            return tokenId;
        } catch (BusinessException ex) {
            throw ex;
        } catch (WebClientResponseException ex) {
            log.warn("seeyon rest/token http error: hostId={}, ticketFp={}, status={}, elapsedMs={}",
                    hostId, fp, ex.getStatusCode().value(), System.currentTimeMillis() - t0);
            cachedToken.set(null);
            throw upstream(hostId, fp, "rest_token_http");
        } catch (WebClientRequestException | IllegalStateException ex) {
            log.warn("seeyon rest/token upstream error: hostId={}, ticketFp={}, type={}, msg={}, elapsedMs={}",
                    hostId, fp, ex.getClass().getSimpleName(), safeMsg(ex), System.currentTimeMillis() - t0);
            cachedToken.set(null);
            throw upstream(hostId, fp, "rest_token_upstream");
        } catch (Exception ex) {
            log.warn("seeyon rest/token unexpected: hostId={}, ticketFp={}, type={}, msg={}, elapsedMs={}",
                    hostId, fp, ex.getClass().getSimpleName(), safeMsg(ex), System.currentTimeMillis() - t0);
            cachedToken.set(null);
            throw upstream(hostId, fp, "rest_token_unexpected");
        }
    }

    private MemberPhone fetchMemberPhone(
            String hostId, String fp, String loginName, String restToken, TicketHostConfig config) {
        if (isBlank(loginName)) {
            log.warn("seeyon orgMember skipped: hostId={}, ticketFp={}, reason=no_login_name", hostId, fp);
            throw new BusinessException(AgentOpsErrorCodes.EMBED_TICKET_INVALID, "外部 ticket 无效");
        }
        String url = trimSlash(config.getBaseUrl()) + "/seeyon/rest/orgMember?loginName="
                + encodeQuery(loginName);
        long t0 = System.currentTimeMillis();
        log.info("seeyon orgMember request: hostId={}, ticketFp={}, loginName={}",
                hostId, fp, maskLogin(loginName));
        try {
            WebClient client = buildClient(config);
            String raw = client.get()
                    .uri(url)
                    .header("token", restToken)
                    .accept(MediaType.APPLICATION_JSON)
                    .retrieve()
                    .bodyToMono(String.class)
                    .block(Duration.ofMillis(config.getReadTimeoutMs() + 1_000L));

            JsonNode root = objectMapper.readTree(raw == null ? "{}" : raw);
            // 部分版本包一层 data
            JsonNode node = root.has("telNumber") ? root
                    : (root.has("data") ? root.get("data") : root);
            String tel = text(node, "telNumber");
            String name = text(node, "name");
            log.info("seeyon orgMember response: hostId={}, ticketFp={}, loginName={}, "
                            + "hasTelNumber={}, hasName={}, elapsedMs={}",
                    hostId, fp, maskLogin(loginName), !isBlank(tel), !isBlank(name),
                    System.currentTimeMillis() - t0);
            return new MemberPhone(blankToNull(tel), blankToNull(name));
        } catch (BusinessException ex) {
            throw ex;
        } catch (WebClientResponseException ex) {
            if (ex.getStatusCode().value() == 401) {
                cachedToken.set(null);
                log.warn("seeyon orgMember 401 (token stale): hostId={}, ticketFp={}, elapsedMs={}",
                        hostId, fp, System.currentTimeMillis() - t0);
            } else {
                log.warn("seeyon orgMember http error: hostId={}, ticketFp={}, status={}, elapsedMs={}",
                        hostId, fp, ex.getStatusCode().value(), System.currentTimeMillis() - t0);
            }
            throw upstream(hostId, fp, "org_member_http");
        } catch (WebClientRequestException | IllegalStateException ex) {
            log.warn("seeyon orgMember upstream error: hostId={}, ticketFp={}, type={}, msg={}, elapsedMs={}",
                    hostId, fp, ex.getClass().getSimpleName(), safeMsg(ex), System.currentTimeMillis() - t0);
            throw upstream(hostId, fp, "org_member_upstream");
        } catch (Exception ex) {
            log.warn("seeyon orgMember unexpected: hostId={}, ticketFp={}, type={}, msg={}, elapsedMs={}",
                    hostId, fp, ex.getClass().getSimpleName(), safeMsg(ex), System.currentTimeMillis() - t0);
            throw upstream(hostId, fp, "org_member_unexpected");
        }
    }

    private WebClient buildClient(TicketHostConfig config) {
        HttpClient httpClient = HttpClient.create()
                .option(ChannelOption.CONNECT_TIMEOUT_MILLIS, config.getConnectTimeoutMs())
                .responseTimeout(Duration.ofMillis(config.getReadTimeoutMs()));
        // 不复用 plain builder 的长超时连接池语义；每次按宿主超时新建
        return WebClient.builder()
                .clientConnector(new ReactorClientHttpConnector(httpClient))
                .build();
    }

    private String parseTokenId(String raw) throws Exception {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        JsonNode node = objectMapper.readTree(raw);
        if (node.has("id") && !node.get("id").isNull()) {
            return node.get("id").asText();
        }
        return null;
    }

    private static BusinessException upstream(String hostId, String fp, String reason) {
        log.warn("seeyon upstream unavailable: hostId={}, ticketFp={}, reason={}", hostId, fp, reason);
        return new BusinessException(AgentOpsErrorCodes.DOWNSTREAM_UNAVAILABLE, "外部验票服务不可用");
    }

    private static String firstHeader(HttpHeaders headers, String... names) {
        for (String name : names) {
            String v = headers.getFirst(name);
            if (v != null && !v.isBlank()) {
                return v.trim();
            }
        }
        return null;
    }

    private static String text(JsonNode node, String field) {
        if (node == null || !node.has(field) || node.get(field).isNull()) {
            return null;
        }
        String v = node.get(field).asText();
        return v == null || v.isBlank() ? null : v.trim();
    }

    private static String encodeQuery(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8);
    }

    private static String trimSlash(String base) {
        if (base == null) {
            return "";
        }
        String t = base.trim();
        while (t.endsWith("/")) {
            t = t.substring(0, t.length() - 1);
        }
        return t;
    }

    private static String sanitizeBaseUrl(String baseUrl) {
        return trimSlash(baseUrl);
    }

    private static String maskLogin(String login) {
        if (login == null || login.isBlank()) {
            return "";
        }
        if (login.length() <= 2) {
            return "**";
        }
        return login.charAt(0) + "****" + login.charAt(login.length() - 1);
    }

    private static String safeMsg(Throwable ex) {
        String m = ex.getMessage();
        if (m == null) {
            return "";
        }
        // 避免偶发把 URL query（含 ticket）打进日志
        String cleaned = m.replaceAll("ticket=[^&\\s]+", "ticket=***");
        return cleaned.substring(0, Math.min(cleaned.length(), 200));
    }

    private static boolean isBlank(String s) {
        return s == null || s.isBlank();
    }

    private static String blankToNull(String s) {
        return isBlank(s) ? null : s.trim();
    }

    private record HandshakeResult(String loginName, String memberId, String memberName) {
    }

    private record MemberPhone(String telNumber, String name) {
    }

    private record CachedRestToken(String hostId, String baseUrl, String token, long expiresAtMs) {
    }
}
