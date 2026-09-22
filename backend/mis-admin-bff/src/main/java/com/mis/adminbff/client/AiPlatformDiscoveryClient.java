package com.mis.adminbff.client;

import com.mis.adminbff.config.AiPlatformProperties;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.Map;

/**
 * 表发现通道客户端（BFF → ai-platform Worker，v1.11 MR-02 / 系统设计 §4.1 a 点）。
 *
 * <p><b>为什么直连 ai-platform 而不经 mis-iqd</b>（架构师裁决，§4.1）：
 * {@code /internal/v1/iqd/discovery/**} 由 Worker 复用 WrenAI 既有 CLI
 * （{@code wren list-models} / {@code wren describe-model} / {@code wren context show}）
 * 读 schema/表/列。若经 Java 中转，会多一跳延迟并扩大凭证可见面（Java 侧本不接触
 * 业务库凭证）；直接 BFF → Worker 与既有 {@code IqdConfigClient} 调用范式一致。
 *
 * <p><b>凭证边界</b>：profile（业务库凭证）由 DBA 按 multiconn §5 流程 server-side 注入
 * WrenAI；前端与 BFF 全程**不触达凭证**（边界红线 3）。
 *
 * <p><b>T01 骨架状态</b>：4 个方法体一律 {@code throw new UnsupportedOperationException("T02 实现")}
 * （表发现在 T02 = M1 基础闭环落地）。由 BFF {@code IqdModelingController} 捕获并翻译成
 * HTTP 503 + traceId。
 *
 * <p><b>端点路径</b>：Worker 侧 4 个端点挂在 {@code /api/v1/iqd/discovery/**}
 * （与既有 {@code /api/v1/iqd/self-heal}、{@code /api/v1/iqd/enhance}、
 * {@code /api/v1/iqd/mcp} 同前缀 —— ai-platform 的所有路由统一 include 于 {@code /api/v1}）。
 */
@Component
public class AiPlatformDiscoveryClient extends AbstractDownstreamClient {

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
     * 取 schema 列表（T02）。{@code GET /api/v1/iqd/discovery/schemas?connectionId=}。
     *
     * @param connectionId 问数连接 id
     * @return {@code {schemas:[string]}}
     */
    public Map<String, Object> listSchemas(Long connectionId) {
        throw new UnsupportedOperationException("T02 实现");
    }

    /**
     * 取表清单（T02）。{@code GET /api/v1/iqd/discovery/tables}。
     *
     * @param connectionId 问数连接 id
     * @param schema       schema 名
     * @param page         页码（从 1 起）
     * @param keyword      表名关键字（可空）
     * @return {@code {tables:[{name,comment}], total, page}}
     */
    public Map<String, Object> listTables(Long connectionId, String schema, Integer page, String keyword) {
        throw new UnsupportedOperationException("T02 实现");
    }

    /**
     * 取列清单（T02）。{@code GET /api/v1/iqd/discovery/columns}。
     *
     * @param connectionId 问数连接 id
     * @param schema       schema 名
     * @param table        表名
     * @return {@code {columns:[{name,type,comment,is_pk_inferred,nullable}]}}
     */
    public Map<String, Object> listColumns(Long connectionId, String schema, String table) {
        throw new UnsupportedOperationException("T02 实现");
    }

    /**
     * 批量导入表（T02）。{@code POST /api/v1/iqd/discovery/import}。
     *
     * @param body {@code {connection_id, tables:[{schema,name}], mode, in_scope}}
     * @return {@code {imported:[item_key], skipped:[item_key]}}
     */
    public Map<String, Object> importTables(Map<String, Object> body) {
        throw new UnsupportedOperationException("T02 实现");
    }
}
