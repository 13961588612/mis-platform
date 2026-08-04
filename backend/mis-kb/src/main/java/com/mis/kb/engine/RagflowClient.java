package com.mis.kb.engine;

import com.mis.common.core.exception.BusinessException;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQuery;
import com.mis.kb.engine.dto.RfChunk;
import com.mis.kb.engine.dto.RfDataset;
import com.mis.kb.engine.dto.RfDocument;
import com.mis.kb.engine.dto.RfResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.web.client.RestClient;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * RAGFlow HTTP 客户端（同步，基于 {@link RestClient}）。
 *
 * <p>仅 mis-kb 内部使用；浏览器/BFF 禁止直连 RAGFlow 或其字段名（dataset_id 等）。
 * 所有 RAGFlow 专属概念（dataset / doc id）均在本类内闭环，转换为 MIS ID 由适配层完成。
 *
 * <p><b>参数落点分野（Wave A 最重要的一条纠偏，设计文档 §7.1）：</b>
 * <ul>
 *   <li><b>建库期</b>（{@link #updateDatasetSettings}，{@code POST /api/v1/datasets/{id}}）：
 *       {@code embedding_model} / {@code chunk_method} / {@code parser_config} / {@code top_k}
 *       / {@code similarity_threshold}；</li>
 *   <li><b>检索期</b>（{@link #retrieve}，{@code POST /api/v1/retrieval}）：
 *       {@code keyword} / {@code vector_similarity_weight} / {@code rerank_id}。</li>
 * </ul>
 * RAGFlow 的 {@code PUT/POST /datasets/{id}} <b>不接受</b>检索方式与权重字段，
 * 硬塞进去要么被忽略、要么 400——这正是二期之前「库级检索方式从未真正生效」的根因之一。
 */
public class RagflowClient {

    private static final Logger log = LoggerFactory.getLogger(RagflowClient.class);

    private final RestClient client;
    private final String apiKey;

    /**
     * 构造客户端。
     *
     * @param builder RestClient 构建器（由 Spring 注入，带全局拦截器）
     * @param props   引擎配置（baseUrl / apiKey）
     */
    public RagflowClient(RestClient.Builder builder, RagflowProperties props) {
        this(builder,
                props == null ? "" : props.getBaseUrl(),
                props == null ? "" : props.getApiKey());
    }

    /**
     * 构造客户端（显式地址/密钥，供测试使用）。
     *
     * @param builder RestClient 构建器
     * @param baseUrl RAGFlow 基础地址
     * @param apiKey  RAGFlow API Key
     */
    public RagflowClient(RestClient.Builder builder, String baseUrl, String apiKey) {
        this.client = builder.baseUrl(baseUrl == null ? "" : baseUrl).build();
        this.apiKey = apiKey == null ? "" : apiKey;
    }

    private String bearer() {
        return apiKey.isBlank() ? "" : "Bearer " + apiKey;
    }

    private <T> RfResponse<T> postFor(String uri, Object body, ParameterizedTypeReference<RfResponse<T>> type) {
        return client.post()
                .uri(uri)
                .header("Authorization", bearer())
                .contentType(MediaType.APPLICATION_JSON)
                .body(body)
                .retrieve()
                .body(type);
    }

    /** 创建 dataset，返回原生 dataset id。 */
    public String createDataset(String name) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        RfResponse<RfDataset> resp = postFor("/api/v1/datasets", body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null) {
            throw new BusinessException(50000, "RAGFlow 创建知识库失败: " + (resp == null ? "无响应" : resp.message()));
        }
        return resp.data().id();
    }

    /**
     * 更新 dataset 设置（建库期 RAG 参数）。
     *
     * <p><b>X-03 缺陷修复：</b>P0 实现把 {@code settings.retrievalMethod()} 误写进了
     * {@code embedding_model} 字段，导致「检索方式」被当成「向量模型名」下发。现修正为
     * {@code embedding_model} ← {@code embeddingModel}，各归其位。
     *
     * <p><b>Wave A 纠偏：</b>不再下发 {@code retrieval_method}。RAGFlow 的 dataset 接口
     * 没有这个字段，检索方式在<b>检索期</b>由 {@code keyword} + {@code vector_similarity_weight}
     * 组合表达（见 {@link #retrieve}）。同理 {@code rerank} 也不在建库期下发——
     * 库级只是个开关，真正生效靠检索期的 {@code rerank_id}。
     *
     * <p>所有字段均为「非 null 才下发」，避免用 null 覆盖 RAGFlow 侧既有配置。
     *
     * @param datasetId 原生 dataset id
     * @param settings  库级 RAG 设置
     */
    public void updateDatasetSettings(String datasetId, RagSettings settings) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (settings != null) {
            if (settings.topK() != null) {
                body.put("top_k", settings.topK());
            }
            if (settings.scoreThreshold() != null) {
                body.put("similarity_threshold", settings.scoreThreshold());
            }
            // 向量模型独立字段，仅在显式配置时下发
            if (settings.embeddingModel() != null && !settings.embeddingModel().isBlank()) {
                body.put("embedding_model", settings.embeddingModel());
            }
            // T03：分块方法与分块参数
            if (settings.chunkMethod() != null && !settings.chunkMethod().isBlank()) {
                body.put("chunk_method", settings.chunkMethod());
            }
            Map<String, Object> parserConfig = new LinkedHashMap<>();
            if (settings.chunkTokenNum() != null) {
                parserConfig.put("chunk_token_num", settings.chunkTokenNum());
            }
            if (settings.separator() != null && !settings.separator().isBlank()) {
                parserConfig.put("delimiter", settings.separator());
            }
            if (!parserConfig.isEmpty()) {
                body.put("parser_config", parserConfig);
            }
        }
        if (body.isEmpty()) {
            // 无任何有效设置项，跳过远端调用，避免空 PUT 触发 RAGFlow 400
            return;
        }
        RfResponse<Void> resp = postFor("/api/v1/datasets/" + datasetId, body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok()) {
            throw new BusinessException(50000, "RAGFlow 更新知识库设置失败: " + (resp == null ? "无响应" : resp.message()));
        }
    }

    /** 删除 dataset。 */
    public void deleteDataset(String datasetId) {
        client.delete()
                .uri("/api/v1/datasets/" + datasetId)
                .header("Authorization", bearer())
                .retrieve()
                .toBodilessEntity();
    }

    /** 上传文档，返回原生 doc id。 */
    public String uploadDocument(String datasetId, DocumentUploadInput input) {
        MultipartBodyBuilder builder = new MultipartBodyBuilder();
        ByteArrayResource resource = new ByteArrayResource(input.content()) {
            @Override
            public String getFilename() {
                return input.filename();
            }
        };
        builder.part("file", resource, MediaType.APPLICATION_OCTET_STREAM);
        RfResponse<List<RfDocument>> resp = client.post()
                .uri("/api/v1/datasets/" + datasetId + "/documents")
                .header("Authorization", bearer())
                .contentType(MediaType.MULTIPART_FORM_DATA)
                .body(builder.build())
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null || resp.data().isEmpty()) {
            throw new BusinessException(50000, "RAGFlow 上传文档失败: " + (resp == null ? "无响应" : resp.message()));
        }
        return resp.data().get(0).id();
    }

    /** 删除文档。 */
    public void deleteDocument(String datasetId, String docId) {
        client.delete()
                .uri("/api/v1/datasets/" + datasetId + "/documents/" + docId)
                .header("Authorization", bearer())
                .retrieve()
                .toBodilessEntity();
    }

    /**
     * 触发文档解析（T04，WA-09）。
     *
     * <p>对应 RAGFlow {@code POST /api/v1/datasets/{dataset_id}/chunks}，请求体
     * {@code {"document_ids": [...]}}。RAGFlow 收到后把文档重新推进解析队列，
     * 其 {@code run}/{@code progress} 字段随之变化——这就是「重新解析」的真实语义。
     *
     * <p>失败必须抛出：重解析是用户主动触发的动作，静默失败会让文档永远卡在
     * {@code PARSING}，而管理员完全看不出发生了什么（错误处理分野，§7.5-6）。
     *
     * @param datasetId 原生 dataset id
     * @param docIds    原生文档 id 列表；空列表直接返回不发请求
     */
    public void parseDocuments(String datasetId, List<String> docIds) {
        if (docIds == null || docIds.isEmpty()) {
            return;
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("document_ids", docIds);
        RfResponse<Void> resp = postFor("/api/v1/datasets/" + datasetId + "/chunks", body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok()) {
            throw new BusinessException(50000,
                    "RAGFlow 触发文档解析失败: " + (resp == null ? "无响应" : resp.message()));
        }
    }

    /**
     * 检索（检索期参数在此下发，WA-02 / WA-05）。
     *
     * <p>请求体字段与 MIS 参数的映射（设计文档 §7.1 / T03 映射规则）：
     * <table border="1">
     *   <caption>检索方式 → RAGFlow 请求体</caption>
     *   <tr><th>retrievalMethod</th><th>keyword</th><th>vector_similarity_weight</th></tr>
     *   <tr><td>{@code vector}</td><td>{@code false}</td><td>{@code 1.0}</td></tr>
     *   <tr><td>{@code keyword}</td><td>{@code true}</td><td>{@code 0.0}</td></tr>
     *   <tr><td>{@code hybrid}</td><td>{@code true}</td><td>{@code vectorSimilarityWeight}</td></tr>
     * </table>
     *
     * <p>{@code rerank_id} <b>仅在</b>「开关为真 且 全局模型 ID 非空」时放入请求体；
     * 否则连键都不出现——传空串会被 RAGFlow 当成一个名为 "" 的模型去查，直接报错。
     *
     * @param query      已由 {@code RetrieveQueryResolver} 合并完成的检索参数
     * @param datasetIds 原生 dataset id 列表
     * @return 原生 chunk 列表
     */
    public List<RfChunk> retrieve(RetrieveQuery query, List<String> datasetIds) {
        String method = query.effectiveRetrievalMethod();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("question", query.question());
        body.put("dataset_ids", datasetIds);
        body.put("page_size", query.effectiveTopK());
        body.put("top_k", query.effectiveTopK());
        body.put("similarity_threshold", query.effectiveThreshold());
        body.put("keyword", mapRetrievalMethodToKeyword(method));
        body.put("vector_similarity_weight", mapRetrievalMethodToWeight(method, query));
        if (query.shouldSendRerankId()) {
            body.put("rerank_id", query.rerankModelId());
        }
        log.debug("RAGFlow 检索请求 datasets={} method={} keyword={} weight={} rerankId={}",
                datasetIds, method, body.get("keyword"), body.get("vector_similarity_weight"),
                body.getOrDefault("rerank_id", "<未下发>"));

        RfResponse<List<RfChunk>> resp = postFor("/api/v1/retrieval", body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null) {
            throw new BusinessException(50000, "RAGFlow 检索失败: " + (resp == null ? "无响应" : resp.message()));
        }
        return resp.data();
    }

    /**
     * 检索方式 → RAGFlow {@code keyword} 布尔。
     *
     * <p>仅 {@code vector}（纯语义）关闭关键字通道，其余两种都要开。
     *
     * @param method 已归一化的检索方式
     * @return {@code keyword} 字段取值
     */
    private static boolean mapRetrievalMethodToKeyword(String method) {
        return !RagSettings.METHOD_VECTOR.equals(method);
    }

    /**
     * 检索方式 → RAGFlow {@code vector_similarity_weight}。
     *
     * @param method 已归一化的检索方式
     * @param query  检索参数（hybrid 时取其权重）
     * @return [0,1] 区间的权重值
     */
    private static double mapRetrievalMethodToWeight(String method, RetrieveQuery query) {
        return switch (method) {
            case RagSettings.METHOD_VECTOR -> 1.0D;
            case RagSettings.METHOD_KEYWORD -> 0.0D;
            default -> query.effectiveVectorSimilarityWeight();
        };
    }

    /** 健康探测：GET /api/v1/health 返回 2xx 即健康。 */
    public boolean health() {
        try {
            var entity = client.get()
                    .uri("/api/v1/health")
                    .header("Authorization", bearer())
                    .retrieve()
                    .toBodilessEntity();
            return entity.getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            return false;
        }
    }
}
