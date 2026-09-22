package com.mis.adminbff.client;

import com.mis.adminbff.config.IqdProperties;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 建模台 mis-iqd 下游客户端（BFF → {@code /api/v1/iqd/**}，v1.11 MR-S1~S4）。
 *
 * <p>继承 {@link AbstractDownstreamClient}，复用其 WebClient + 身份头透传机制
 * （{@code loginContextHeaders()}，供 mis-iqd 侧 DataScope / 操作人校验），
 * 与既有 {@code IqdClient} 同口径。
 *
 * <h2>方法集（14）</h2>
 * <ul>
 *   <li><b>T02a</b>：{@code createConnection} / {@code listConnections} /
 *       {@code testConnection} / {@code createModelFromTable} / {@code validateExpression} /
 *       {@code getCatalogSyncStatus}</li>
 *   <li><b>T03</b>：{@code createModel} / {@code createRelationship} / {@code createCube} /
 *       {@code createCalculatedColumn} / {@code listDependencies} /
 *       {@code getModelLayout} / {@code saveModelLayout} /
 *       {@code autoLayout}（**按设计不实现** → 抛 {@code UnsupportedOperationException}
 *       → BFF 控制器转 HTTP 501，见方法注释与 A-02）</li>
 * </ul>
 *
 * <h2>错误透传（关键）</h2>
 * mis-iqd 的业务冲突按二/四期口径返回 **HTTP 200 + {@code body.code}**
 * （40900 乐观并发 / 42200 参数或源表不存在 / 40901 幂等键并发 / 40300 写回闸门关闭）。
 * {@link AbstractDownstreamClient#block} 经 {@code RequestContext.unwrap} 解包，
 * 失败时抛 {@code BusinessException(code, message, data)} —— **code 与 data 均保留**，
 * 故 BFF 控制器能把 {@code current_edit_revision}（40900）、{@code idempotency_key}（40901）
 * 等明细原样交给前端，而不是降级成 50000。这点与既有
 * {@code IqdClient.updateCatalogNode} 完全一致。
 *
 * <p>表发现 4 端点的下游是 ai-platform Worker（**非** mis-iqd），故落在
 * {@link AiPlatformDiscoveryClient}，不重复在此声明。
 */
@Component
public class IqdModelingClient extends AbstractDownstreamClient {

    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<Map<String, Object>>> MAP_RESULT =
            new ParameterizedTypeReference<>() {};
    private static final ParameterizedTypeReference<com.mis.common.core.result.Result<List<Map<String, Object>>>> MAP_LIST_RESULT =
            new ParameterizedTypeReference<>() {};

    private final IqdProperties properties;

    public IqdModelingClient(
            @Qualifier("plainWebClientBuilder") WebClient.Builder plainBuilder,
            IqdProperties properties) {
        super(plainBuilder.baseUrl(properties.getBaseUrl()).build(), properties.getTimeoutMs());
        this.properties = properties;
    }

    /** 供 Facade / 后续任务读取注入配置（权限码等）。 */
    public IqdProperties properties() {
        return properties;
    }

    // ------------------------------------------------------------------ 连接向导（T02a 已实现）

    /** 新建连接（T02a）。{@code POST /api/v1/iqd/connections}。 */
    public Map<String, Object> createConnection(Map<String, Object> body) {
        return block(client().post()
                .uri("/api/v1/iqd/connections")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /** 连接清单（T02a）。{@code GET /api/v1/iqd/connections}。 */
    public List<Map<String, Object>> listConnections() {
        return block(client().get()
                .uri("/api/v1/iqd/connections")
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_LIST_RESULT));
    }

    /** 连接连通性自检（T02a）。{@code POST /api/v1/iqd/connections/{id}/test}。 */
    public Map<String, Object> testConnection(Long connectionId) {
        return block(client().post()
                .uri("/api/v1/iqd/connections/{id}/test", connectionId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    // ------------------------------------------------------------------ 新建节点族（§4.3 c 点）

    /** 由物理表生成模型（T02a 已实现）。{@code POST /api/v1/iqd/catalog/model/from-table}。 */
    public Map<String, Object> createModelFromTable(Map<String, Object> body) {
        return block(client().post()
                .uri("/api/v1/iqd/catalog/model/from-table")
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /** 表达式静态校验（T02a 已实现）。{@code GET /api/v1/iqd/catalog/validate-expression}。 */
    public Map<String, Object> validateExpression(Long connectionId, String modelItemKey, String expression) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/catalog/validate-expression")
                        .queryParam("connectionId", connectionId)
                        .queryParam("modelItemKey", modelItemKey)
                        .queryParam("expression", expression)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /** 连接级编辑同步状态（T02a 已实现）。{@code GET /api/v1/iqd/catalog/sync-status}。 */
    public Map<String, Object> getCatalogSyncStatus(Long connectionId) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/catalog/sync-status")
                        .queryParam("connectionId", connectionId)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    // ------------------------------------------------------------------ 新建节点族（T03 落地）

    /** 空白模型创建。{@code POST /api/v1/iqd/catalog/model}。 */
    public Map<String, Object> createModel(Map<String, Object> body) {
        return postJson("/api/v1/iqd/catalog/model", body);
    }

    /** 新建关系。{@code POST /api/v1/iqd/catalog/relationship}。 */
    public Map<String, Object> createRelationship(Map<String, Object> body) {
        return postJson("/api/v1/iqd/catalog/relationship", body);
    }

    /** 新建 Cube（含 measures/dimensions）。{@code POST /api/v1/iqd/catalog/cube}。 */
    public Map<String, Object> createCube(Map<String, Object> body) {
        return postJson("/api/v1/iqd/catalog/cube", body);
    }

    /** 新建计算列。{@code POST /api/v1/iqd/catalog/calculated-column}。 */
    public Map<String, Object> createCalculatedColumn(Map<String, Object> body) {
        return postJson("/api/v1/iqd/catalog/calculated-column", body);
    }

    /** 直接引用方清单。{@code GET /api/v1/iqd/dependencies?connectionId=&itemKey=}。 */
    public Map<String, Object> listDependencies(Long connectionId, String itemKey) {
        return block(client().get()
                .uri(uriBuilder -> uriBuilder.path("/api/v1/iqd/dependencies")
                        .queryParam("connectionId", connectionId)
                        .queryParam("itemKey", itemKey)
                        .build())
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    // ------------------------------------------------------------------ 画布布局（§4.4 d 点，MR-S4）

    /** 取连接级布局。{@code GET /api/v1/iqd/modeling/layout/{connectionId}}。 */
    public Map<String, Object> getModelLayout(Long connectionId) {
        return block(client().get()
                .uri("/api/v1/iqd/modeling/layout/{id}", connectionId)
                .headers(loginContextHeaders())
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 保存连接级布局。{@code PUT /api/v1/iqd/modeling/layout/{connectionId}}。
     *
     * <p>{@code base_version} 以**显式入参**为准（非 null 时覆盖 body 里的同名字段），
     * 避免「body 里带了旧 base_version」导致乐观并发形同虚设。
     * 下游不符时抛 {@code BusinessException(40900, ..., {current_version})}，由 BFF 透传给前端。
     */
    public Map<String, Object> saveModelLayout(Long connectionId, Map<String, Object> layout, Integer baseVersion) {
        Map<String, Object> payload = new LinkedHashMap<>();
        if (layout != null) {
            payload.putAll(layout);
        }
        if (baseVersion != null) {
            payload.put("base_version", baseVersion);
        }
        return block(client().put()
                .uri("/api/v1/iqd/modeling/layout/{id}", connectionId)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(payload)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }

    /**
     * 一键自动布局 —— <b>服务端按设计不实现</b>（A-02 裁决，HTTP 501）。
     *
     * <p>直接抛 {@code UnsupportedOperationException}（不发起下游调用）：BFF 控制器据此返回
     * <b>HTTP 501 + code 50101</b>。前端 {@code AutoLayoutButton} 应在浏览器侧跑
     * {@code @dagrejs/dagre} 算坐标，再经 {@link #saveModelLayout} 落库。
     */
    public Map<String, Object> autoLayout(Long connectionId, Map<String, Object> algorithm) {
        throw new UnsupportedOperationException(
                "服务端不实现自动布局（A-02）：请在浏览器侧用 @dagrejs/dagre 计算坐标，"
                        + "再经 PUT /api/v1/iqd/modeling/layout/" + connectionId + " 落库。");
    }

    // ------------------------------------------------------------------ 内部

    /** 统一带 JSON body 的 POST（BFF → mis-iqd，透传登录上下文）。 */
    private Map<String, Object> postJson(String path, Map<String, Object> body) {
        return block(client().post()
                .uri(path)
                .headers(loginContextHeaders())
                .contentType(MediaType.APPLICATION_JSON)
                .bodyValue(body == null ? Map.of() : body)
                .retrieve()
                .bodyToMono(MAP_RESULT));
    }
}
