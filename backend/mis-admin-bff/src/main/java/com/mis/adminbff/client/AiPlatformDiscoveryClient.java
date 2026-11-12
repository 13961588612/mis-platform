package com.mis.adminbff.client;

import com.mis.adminbff.config.AiPlatformProperties;
import com.mis.adminbff.support.DownstreamAuthContext;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.common.core.result.Result;
import com.mis.common.web.trace.TraceContext;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;
import java.util.function.Consumer;

/**
 * 表发现通道客户端（BFF → ai-platform Worker，v1.11 MR-02 / 系统设计 §4.1 a 点）。
 *
 * <p><b>为什么直连 ai-platform 而不经 mis-iqd</b>（架构师裁决，§4.1）：
 * 表发现由 Worker 经 WrenAI MCP（{@code list_models} / {@code describe_model}）
 * 读 schema/表/列。若经 Java 中转，会多一跳延迟并扩大凭证可见面（Java 侧本不接触
 * 业务库凭证）；直接 BFF → Worker 与既有问数 / MCP 管理调用范式一致。
 *
 * <p><b>凭证边界</b>：profile（业务库凭证）由 DBA 按 multiconn §5 流程 server-side 注入
 * WrenAI；前端与 BFF 全程<strong>不触达凭证</strong>（边界红线 3）。
 *
 * <p><b>鉴权</b>：经 {@link DownstreamAuthContext} 透传 MIS JWT +
 * {@link #loginContextHeaders()}，与 {@link AgentOpsTransport} / {@link AiPlatformClient}
 * 一致，供 ai-platform {@code get_current_user} 走 RS256。
 *
 * <p><b>端点路径</b>：Worker 侧 4 个端点挂在 {@code /api/v1/iqd/discovery/**}。
 */
@Component
public class AiPlatformDiscoveryClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<Result<Map<String, Object>>> MAP_RESULT_TYPE =
            new ParameterizedTypeReference<>() {};

    private final AiPlatformProperties properties;

    public AiPlatformDiscoveryClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            AiPlatformProperties properties) {
        super(plainBuilder.baseUrl(properties.getBaseUrl()).build(), properties.getChatTimeoutMs());
        this.properties = properties;
    }

    /** 供 Facade / 后续任务读取注入配置。 */
    public AiPlatformProperties properties() {
        return properties;
    }

    /**
     * 取 schema 列表。{@code GET /api/v1/iqd/discovery/schemas?connectionId=}。
     *
     * @param connectionId 问数连接 id
     * @return {@code {schemas:[string]}}
     */
    public Map<String, Object> listSchemas(Long connectionId) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/discovery/schemas")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(platformHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 取表清单。{@code GET /api/v1/iqd/discovery/tables}。
     *
     * @param connectionId 问数连接 id
     * @param schema       schema 名
     * @param page         页码（从 1 起）
     * @param keyword      表名关键字（可空）
     * @return {@code {tables:[{name,comment}], total, page}}
     */
    public Map<String, Object> listTables(Long connectionId, String schema, Integer page, String keyword) {
        return block(client().get()
                .uri(uriBuilder -> {
                    var b = uriBuilder.path("/api/v1/iqd/discovery/tables")
                            .queryParam("connectionId", connectionId)
                            .queryParam("schema", schema)
                            .queryParam("page", page == null ? 1 : page);
                    if (keyword != null && !keyword.isBlank()) {
                        b.queryParam("keyword", keyword);
                    }
                    return b.build();
                })
                .headers(platformHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 取列清单。{@code GET /api/v1/iqd/discovery/columns}。
     *
     * @param connectionId 问数连接 id
     * @param schema       schema 名
     * @param table        表名
     * @return {@code {columns:[{name,type,comment,is_pk_inferred,nullable}]}}
     */
    public Map<String, Object> listColumns(Long connectionId, String schema, String table) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/discovery/columns")
                        .queryParam("connectionId", connectionId)
                        .queryParam("schema", schema)
                        .queryParam("table", table)
                        .build())
                .headers(platformHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 批量导入表。{@code POST /api/v1/iqd/discovery/import}。
     *
     * @param body {@code {connection_id, tables:[{schema,name}], mode, in_scope}}
     * @return {@code {imported:[item_key], skipped:[item_key]}}
     */
    public Map<String, Object> importTables(Map<String, Object> body) {
        return block(client().post()
                .uri("/api/v1/iqd/discovery/import")
                .headers(platformHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body == null ? Map.of() : body)
                .retrieve()
                .bodyToMono(MAP_RESULT_TYPE));
    }

    /**
     * 透传 MIS JWT + 登录上下文 + Trace-Id，供 ai-platform RS256 鉴权。
     */
    private Consumer<HttpHeaders> platformHeaders() {
        return headers -> {
            loginContextHeaders().accept(headers);
            String jwt = DownstreamAuthContext.getToken();
            if (jwt != null && !jwt.isBlank()) {
                headers.set(SecurityConstants.AUTHORIZATION_HEADER, jwt);
            }
            String traceId = TraceContext.currentTraceId();
            if (traceId != null && !traceId.isBlank()) {
                headers.set(SecurityConstants.HEADER_TRACE_ID, traceId);
            }
        };
    }
}
