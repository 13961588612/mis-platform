package com.mis.kb.engine;

import com.mis.common.core.exception.BusinessException;
import com.mis.kb.domain.model.DocumentChunkConfig;
import com.mis.kb.domain.model.DocumentUploadInput;
import com.mis.kb.domain.model.RagSettings;
import com.mis.kb.domain.model.RetrieveQuery;
import com.mis.kb.engine.dto.RfChunk;
import com.mis.kb.engine.dto.RfDataset;
import com.mis.kb.engine.dto.RfDocument;
import com.mis.kb.engine.dto.RfDocumentPage;
import com.mis.kb.engine.dto.RfModel;
import com.mis.kb.engine.dto.RfResponse;
import com.mis.kb.engine.dto.RfRetrievalData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * RAGFlow HTTP 客户端（同步，基于 {@link RestClient}）。
 *
 * <p>仅 mis-kb 内部使用；浏览器/BFF 禁止直连 RAGFlow 或其字段名（dataset_id 等）。
 * 所有 RAGFlow 专属概念（dataset / doc id）均在本类内闭环，转换为 MIS ID 由适配层完成。
 *
 * <p><b>参数落点分野（Wave A 最重要的一条纠偏，设计文档 §7.1；B2 实测校正）：</b>
 * <ul>
 *   <li><b>建库期</b>（{@link #updateDatasetSettings}，<b>PUT</b> {@code /api/v1/datasets/{id}}）：
 *       {@code embedding_model} / {@code chunk_method} / {@code parser_config}；
 *       旧实现误用 POST（本实例 405，设置从未生效）且夹带 {@code top_k} /
 *       {@code similarity_threshold}（本实例 pydantic 严格校验，整个请求被拒）；</li>
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

    private <T> RfResponse<T> putFor(String uri, Object body, ParameterizedTypeReference<RfResponse<T>> type) {
        return client.put()
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
     * <p><b>B2 修复（2026-08-11，实测 10.254.16.6:9380）：</b>
     * <ol>
     *   <li><b>HTTP 方法必须是 PUT</b>——旧实现用 {@code POST /api/v1/datasets/{id}}，
     *       该实例返回 {@code code:100 MethodNotAllowed '405'}，设置<b>从未到达 RAGFlow</b>，
     *       这正是「分隔符 ### 实际无效果」的直接根因（用户再怎么重解析也没用，因为
     *       RAGFlow 侧的 parser_config 根本没变）；</li>
     *   <li><b>body 只允许本实例认的字段</b>——实测该版本 PUT 请求体为 pydantic 严格校验
     *       （extra=forbid），{@code top_k} / {@code similarity_threshold} /
     *       {@code vector_similarity_weight} 任一出现都会让<b>整个请求</b>返回
     *       {@code code:101 "Extra inputs are not permitted"}。这三个字段是<b>检索期</b>
     *       参数，已在 {@link #retrieve} 随检索请求下发，不应再出现在建库期 body 里。
     *       旧实现把 {@code topK} / {@code scoreThreshold} 硬塞进来，导致 PUT 全量失败。</li>
     * </ol>
     * 本方法现只下发本实例接受的四个键：{@code embedding_model} / {@code chunk_method} /
     * {@code parser_config}（内嵌 {@code chunk_token_num} / {@code delimiter}）。
     * {@code topK} / {@code scoreThreshold} 仍按原语义保存在本地并由检索期合并器生效。
     *
     * <p>所有字段均为「非 null 才下发」，避免用 null 覆盖 RAGFlow 侧既有配置。
     *
     * @param datasetId 原生 dataset id
     * @param settings  库级 RAG 设置
     */
    public void updateDatasetSettings(String datasetId, RagSettings settings) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (settings != null) {
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
            // 无任何有效设置项（如仅 topK/scoreThreshold 被修改），跳过远端调用：
            // 这两个字段属检索期参数，本实例不接受在 dataset 级下发，留待检索请求携带
            return;
        }
        RfResponse<RfDataset> resp = putFor("/api/v1/datasets/" + datasetId, body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok()) {
            throw new BusinessException(50000, "RAGFlow 更新知识库设置失败: " + (resp == null ? "无响应" : resp.message()));
        }
    }

    /**
     * 删除 dataset。
     *
     * <p><b>DELETE 405 显式失败修复（2026-08-12，实测 10.254.16.6:9380）：</b>
     * 该实例 {@code DELETE /api/v1/datasets/{id}} 返回 405 MethodNotAllowed——
     * RAGFlow 这个版本<b>根本不提供</b> dataset 物理删除。旧实现用
     * {@code toBodilessEntity()} 吞掉错误体，405 被当成「成功」返回，
     * 删除知识库在引擎侧<b>从未发生</b>却毫无告警（静默假成功）。
     *
     * <p>本方法改为<b>显式失败</b>：非 2xx 一律抛 {@link BusinessException}，
     * 由调用方（{@code KbLibraryService.delete}）感知并记录 WARN。不做「PUT enabled=0
     * 停用」冒充删除——停用语义已被 {@link #updateDocumentEnabled} 占用（B1），
     * 且停用 ≠ 删除（文档/chunks 保留），语义必须区分。
     *
     * @param datasetId 原生 dataset id
     * @throws BusinessException RAGFlow 返回非 2xx（含 405）时抛出，不再静默
     */
    public void deleteDataset(String datasetId) {
        deleteFor("/api/v1/datasets/" + datasetId, "RAGFlow 删除知识库失败");
    }

    /**
     * 模型池探测（T02，kb_settings_model_chunk）。
     *
     * <p><b>T00 P1 实测固化：</b>接口路径是 {@code GET /api/v1/models}（不是
     * {@code /api/v1/llm/list}——该路径在本实例返回 404）；响应字段为
     * {@code name} / {@code model_type}(数组) / {@code provider_name} / {@code instance_name}。
     *
     * <p>id 全限定拼接（{@code name@instance_name@provider_name}）由 {@link RagflowAdapter}
     * 负责；本方法只承载原生列表，分类在适配层完成。
     *
     * @return RAGFlow 原生模型列表；失败抛异常由 {@code EngineModelPoolService} 降级
     */
    public List<RfModel> listModels() {
        RfResponse<List<RfModel>> resp = client.get()
                .uri("/api/v1/models")
                .header("Authorization", bearer())
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null) {
            throw new BusinessException(50000,
                    "RAGFlow 查询模型列表失败: " + (resp == null ? "无响应" : resp.message()));
        }
        return resp.data();
    }

    /**
     * 更新文档级切片配置（T04，kb_settings_model_chunk）。
     *
     * <p><b>T00 P3/P5 实测固化：</b>
     * <ul>
     *   <li>路径 {@code PUT /api/v1/datasets/{datasetId}/documents/{docId}}；</li>
     *   <li>白名单键：顶层 {@code chunk_method} + {@code parser_config{chunk_token_num, delimiter}}；
     *       {@code parser_config} 内未知键 → code:102（严格）；顶层多余键被静默忽略，但仍只下发白名单键；</li>
     *   <li>键名是 {@code chunk_token_num}（非 {@code chunk_token_count}）；</li>
     *   <li>PUT 之后<b>不会</b>自动重解析（run 仍 UNSTART），必须由调用方显式
     *       {@link #parseDocuments}（两步式，T00 P5）。</li>
     * </ul>
     *
     * <p><b>只下发文件级非空字段</b>（设计 §3.2.2 引擎下发差异）：未指定字段沿用 dataset 快照
     * = 库级，与「未指定继承库级」天然一致；不在此下发合并后的有效值。
     *
     * @param datasetId 原生 dataset id
     * @param docId     原生文档 id
     * @param config    文件级切片配置；全 null/无有效字段则直接返回不发请求
     */
    public void updateDocumentConfig(String datasetId, String docId, DocumentChunkConfig config) {
        Map<String, Object> body = new LinkedHashMap<>();
        if (config == null) {
            return;
        }
        if (config.chunkMethod() != null && !config.chunkMethod().isBlank()) {
            body.put("chunk_method", config.chunkMethod());
        }
        Map<String, Object> parserConfig = new LinkedHashMap<>();
        if (config.chunkTokenNum() != null) {
            parserConfig.put("chunk_token_num", config.chunkTokenNum());
        }
        if (config.separator() != null && !config.separator().isBlank()) {
            parserConfig.put("delimiter", config.separator());
        }
        if (!parserConfig.isEmpty()) {
            body.put("parser_config", parserConfig);
        }
        if (body.isEmpty()) {
            return;
        }
        RfResponse<RfDocument> resp = putFor(
                "/api/v1/datasets/" + datasetId + "/documents/" + docId, body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok()) {
            throw new BusinessException(50000,
                    "RAGFlow 更新文档配置失败: " + (resp == null ? "无响应" : resp.message()));
        }
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

    /**
     * 分页列出 dataset 下文档（含 {@code run}/{@code progress}，供解析状态回写）。
     *
     * @param datasetId 原生 dataset id
     * @param page      1-based
     * @param pageSize  每页条数
     */
    public List<RfDocument> listDocuments(String datasetId, int page, int pageSize) {
        RfResponse<RfDocumentPage> resp = client.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/datasets/" + datasetId + "/documents")
                        .queryParam("page", Math.max(page, 1))
                        .queryParam("page_size", Math.max(pageSize, 1))
                        .build())
                .header("Authorization", bearer())
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null || resp.data().docs() == null) {
            throw new BusinessException(50000,
                    "RAGFlow 查询文档列表失败: " + (resp == null ? "无响应" : resp.message()));
        }
        return resp.data().docs();
    }

    /**
     * 按原生 doc id 查询单文档（用于列表中少量 parsing 文档的状态回写）。
     *
     * @return 找不到时返回 null
     */
    public RfDocument getDocument(String datasetId, String docId) {
        if (docId == null || docId.isBlank()) {
            return null;
        }
        RfResponse<RfDocumentPage> resp = client.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/datasets/" + datasetId + "/documents")
                        .queryParam("id", docId)
                        .queryParam("page", 1)
                        .queryParam("page_size", 1)
                        .build())
                .header("Authorization", bearer())
                .retrieve()
                .body(new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null || resp.data().docs() == null
                || resp.data().docs().isEmpty()) {
            return null;
        }
        return resp.data().docs().get(0);
    }

    /**
     * 删除文档。
     *
     * <p><b>DELETE 405 显式失败修复（同 {@link #deleteDataset}）：</b>该实例
     * {@code DELETE /api/v1/datasets/{id}/documents/{docId}} 返回 405，物理删除
     * 不可用。旧实现 {@code toBodilessEntity()} 吞错误体 → 静默假成功。现改为
     * 非 2xx 抛 {@link BusinessException}，由调用方（{@code KbDocumentService.delete}）
     * 感知并记录 WARN。「停用」请用 {@link #updateDocumentEnabled}（B1 真实启停，
     * 不删除、可恢复），不要把停用实现成删除。
     *
     * @param datasetId 原生 dataset id
     * @param docId     原生文档 id
     * @throws BusinessException RAGFlow 返回非 2xx（含 405）时抛出，不再静默
     */
    public void deleteDocument(String datasetId, String docId) {
        deleteFor("/api/v1/datasets/" + datasetId + "/documents/" + docId, "RAGFlow 删除文档失败");
    }

    /**
     * DELETE 统一出口：非 2xx（含 405）抛 {@link BusinessException}，不再静默。
     *
     * <p>两层防护：
     * <ol>
     *   <li>{@code RestClient} 默认错误处理器对 4xx/5xx 抛
     *       {@link RestClientResponseException} —— 捕获后转成与全类一致的
     *       {@link BusinessException}（调用方只认业务异常一种形态）；</li>
     *   <li>若某处配置了不抛异常的 errorHandler（返回 ResponseEntity），
     *       再按状态码显式判一次，双保险堵住「假成功」。</li>
     * </ol>
     *
     * @param uri           相对 baseUrl 的删除路径
     * @param failurePrefix 失败消息前缀（区分知识库/文档）
     */
    private void deleteFor(String uri, String failurePrefix) {
        try {
            var resp = client.delete()
                    .uri(uri)
                    .header("Authorization", bearer())
                    .retrieve()
                    .toBodilessEntity();
            if (resp == null || !resp.getStatusCode().is2xxSuccessful()) {
                throw new BusinessException(50000, failurePrefix + ": HTTP "
                        + (resp == null ? "无响应" : resp.getStatusCode().value()));
            }
        } catch (RestClientResponseException ex) {
            throw new BusinessException(50000, failurePrefix + ": HTTP "
                    + ex.getStatusCode().value() + " " + ex.getMessage());
        }
    }

    /**
     * 设置文档启用/停用（B1 修复）。
     *
     * <p>对应 RAGFlow {@code PUT /api/v1/datasets/{dataset_id}/documents/{document_id}}，
     * 请求体 {@code {"enabled": 1|0}}。实测（10.254.16.6:9380）该版本的 {@code enabled}
     * 必须是<b>整数 0/1</b>——传布尔 {@code true/false} 会被 pydantic 拒绝
     * （{@code code:102 "Input should be a valid integer"}）。
     *
     * <p>启停只切换检索可见性：实测停用后 retrieval 不再命中该文档（7 hits → 0 → 恢复 7），
     * 且文档与其 chunks <b>原样保留</b>（run=DONE / chunk_count 不变）——<b>绝不删除</b>。
     * 旧实现把「停用」实现成 {@link #deleteDocument}（不可逆删除）、「启用」什么都不做，
     * 语义完全错误，已在此修正。
     *
     * @param datasetId 原生 dataset id
     * @param docId     原生文档 id
     * @param enabled   true=启用（{@code enabled:1}）；false=停用（{@code enabled:0}）
     */
    public void updateDocumentEnabled(String datasetId, String docId, boolean enabled) {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("enabled", enabled ? 1 : 0);
        RfResponse<RfDocument> resp = putFor(
                "/api/v1/datasets/" + datasetId + "/documents/" + docId, body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok()) {
            throw new BusinessException(50000,
                    "RAGFlow 更新文档启用状态失败: " + (resp == null ? "无响应" : resp.message()));
        }
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
     * 检索（检索期参数在此下发，WA-02 / WA-05 / B3 实测校正）。
     *
     * <p><b>B3 实测校正（2026-08-12，远程 10.254.16.6:9380）：</b>
     * <ol>
     *   <li><b>请求体必须是「顶层扁平字段」，不是嵌套 {@code retrieval_setting}。</b>
     *       实测该实例对 {@code retrieval_setting} 内的一切字段（search_method/keyword/
     *       vector_similarity_weight/top_k/similarity_threshold/rerank_id）<b>全部静默忽略</b>
     *       （未知字段被 pydantic 丢弃，不报错、不生效），真正生效的是顶层同名字段。
     *       上一轮「嵌套格式命中 7 条、扁平格式 0 条」的结论是<b>误判</b>：那次扁平
     *       请求带的是 {@code top_k=1024} + {@code similarity_threshold=0.1} + 关键词组合，
     *       实测<b>单独</b>验证发现真正让扁平请求返回 0 的是 {@code keyword=true}
     *       （该实例 keyword=true 时走全文候选，query 无全文命中即 0），而非「扁平格式
     *       本身不生效」；嵌套格式 7 条是因为 retrieval_setting 被忽略后回落默认参数。</li>
     *   <li><b>响应 {@code data} 是对象</b> {@code {chunks, doc_aggs, total}}，不是数组；
     *       {@link RfRetrievalData} 承载 chunks 列表。</li>
     *   <li><b>chunk 字段名</b>：正文是 {@code content}（不是 {@code text}）、
     *       分数是 {@code similarity}（不是 {@code score}）、文档名是
     *       {@code document_keyword}（不是 {@code document_name}）——见 {@link RfChunk}。</li>
     *   <li><b>top_k vs page_size</b>：{@code page_size}=最终返回条数（MIS topK 落这里），
     *       {@code top_k}=向量召回候选数（默认 1024，不限制输出条数）。</li>
     *   <li><b>rerank_id 在顶层</b>，且必须是「模型名@提供方@实例」全限定格式
     *       （如 {@code qwen3-rerank@Tongyi-Qianwen@Tongyi-Qianwen}）；裸模型名会被拒
     *       （code:100 Provider not found）。MIS 侧 {@code shouldSendRerankId()} 判空逻辑不变。</li>
     * </ol>
     *
     * <p>请求体字段与 MIS 参数的映射（设计文档 §7.1 / T03 映射规则 / B3 实测校正）：
     * <table border="1">
     *   <caption>检索方式 → RAGFlow 请求体</caption>
     *   <tr><th>retrievalMethod</th><th>keyword</th><th>vector_similarity_weight</th></tr>
     *   <tr><td>{@code vector}</td><td>{@code false}</td><td>{@code 1.0}</td></tr>
     *   <tr><td>{@code keyword}</td><td>{@code true}</td><td>{@code 0.0}</td></tr>
     *   <tr><td>{@code hybrid}</td><td>{@code false}</td><td>{@code vectorSimilarityWeight}</td></tr>
     * </table>
     * 实测注：该实例 {@code keyword=true} 时走全文候选（query 无全文命中即 0 条），
     * {@code keyword=false} 时走向量候选且 {@code similarity_threshold}/{@code top_k}/
     * {@code page_size} 生效。MIS 的 hybrid 语义（关键词 + 语义）与本实例 keyword=true
     * 的「全文候选」并不完全等价，但这是该版本可用的最接近表达，保留 keyword/weight
     * 组合映射（不用 search_method——本实例顶层 search_method 也不生效）。
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
        // B3 校正：page_size=最终返回条数（MIS topK 落这里）；top_k 不塞 effectiveTopK
        // （那是候选数，默认 1024 即可，硬塞小值反而截断召回候选）
        body.put("page_size", query.effectiveTopK());
        body.put("similarity_threshold", query.effectiveThreshold());
        body.put("keyword", mapRetrievalMethodToKeyword(method));
        body.put("vector_similarity_weight", mapRetrievalMethodToWeight(method, query));
        if (query.shouldSendRerankId()) {
            body.put("rerank_id", query.rerankModelId());
        }
        log.debug("RAGFlow 检索请求 datasets={} method={} keyword={} weight={} pageSize={} threshold={} rerankId={}",
                datasetIds, method, body.get("keyword"), body.get("vector_similarity_weight"),
                body.get("page_size"), body.get("similarity_threshold"),
                body.getOrDefault("rerank_id", "<未下发>"));

        RfResponse<RfRetrievalData> resp = postFor("/api/v1/retrieval", body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null) {
            throw new BusinessException(50000, "RAGFlow 检索失败: " + (resp == null ? "无响应" : resp.message()));
        }
        return resp.data().chunksOrEmpty();
    }

    /**
     * 检索方式 → RAGFlow {@code keyword} 布尔。
     *
     * <p><b>B3 实测校正（10.254.16.6:9380）：</b>该实例 {@code keyword=true} 时走
     * <b>全文候选</b>——query 无全文命中即返回 0 条；{@code keyword=false} 时走向量候选，
     * 且 {@code vector_similarity_weight} 的向量/词项混合打分<b>仍然生效</b>
     * （实测 kw=false + weight=0.3 的 sim=0.3*vec+0.7*term，且排名会随权重变化）。
     * 因此：
     * <ul>
     *   <li>{@code vector} → {@code false}（纯向量）；</li>
     *   <li>{@code keyword} → {@code true}（纯全文，正是用户要的「关键字检索」）；</li>
     *   <li>{@code hybrid} → <b>{@code false}</b>（旧实现误发 {@code true}，导致 hybrid
     *       被限制成全文候选，query 无全文命中即空结果——这正是「甚至可能空结果」的直接根因）。
     *       hybrid 的「关键词 + 语义」由 {@code keyword=false} 的向量候选 +
     *       {@code vector_similarity_weight} 混合打分承担。</li>
     * </ul>
     *
     * @param method 已归一化的检索方式
     * @return {@code keyword} 字段取值
     */
    private static boolean mapRetrievalMethodToKeyword(String method) {
        return RagSettings.METHOD_KEYWORD.equals(method);
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

    /**
     * 健康探测：部分 RAGFlow 版本无 {@code /api/v1/health}（404）。
     * 改用轻量 {@code GET /api/v1/datasets?page=1&page_size=1}，2xx 即视为可达且鉴权有效。
     */
    public boolean health() {
        try {
            var entity = client.get()
                    .uri("/api/v1/datasets?page=1&page_size=1")
                    .header("Authorization", bearer())
                    .retrieve()
                    .toBodilessEntity();
            return entity.getStatusCode().is2xxSuccessful();
        } catch (Exception e) {
            return false;
        }
    }
}
