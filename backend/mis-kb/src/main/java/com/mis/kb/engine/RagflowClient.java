package com.mis.kb.engine;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
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
import com.mis.kb.engine.dto.RfSearchChunk;
import com.mis.kb.engine.dto.RfSearchData;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.ParameterizedTypeReference;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.http.client.MultipartBodyBuilder;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
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

    /**
     * 构图触发/状态查询的 index type 参数值。
     *
     * <p><b>必须是 {@code graph}，禁止写 {@code graphrag}</b>——T00 G2 实测
     * （{@code ragflow-graphrag-probe-2026-08-11.md}）：传 {@code graphrag} 返回
     * {@code code:102 Invalid index type}；合法值是 {@code graph}（内部任务类型才是
     * graphrag）。这是最容易踩的坑，写进共享知识 §10-2。
     */
    public static final String INDEX_TYPE_GRAPH = "graph";

    /**
     * RAPTOR 构建触发/状态查询的 index type 参数值（Wave C RAPTOR）。
     *
     * <p><b>必须是 {@code raptor}</b>——T00 P2a/P2b 实测
     * （{@code ragflow-raptor-probe-2026-08-12.md}）：{@code POST/GET .../index?type=raptor}
     * 与 graph 同构（触发返回 {@code task_id}，状态返回 {@code progress}：
     * 1.0=完成 / -1=失败 / 其他=构建中）。
     */
    public static final String INDEX_TYPE_RAPTOR = "raptor";

    /** 构图 method 值（T00 G1 实测：light/graph 二选一；PoC 用 light 快速构图）。 */
    private static final String GRAPH_METHOD_LIGHT = "light";

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
     * 本方法只下发本实例接受的键：{@code embedding_model} / {@code chunk_method} /
     * {@code parser_config}（内嵌 {@code chunk_token_num} / {@code delimiter} /
     * {@code raptor} / {@code graphrag}）。
     * {@code topK} / {@code scoreThreshold} 仍按原语义保存在本地并由检索期合并器生效。
     *
     * <p><b>Wave C P1f 关键契约（最高优先级，T00 实测）：</b>引擎在<b>切换
     * {@code chunk_method}</b> 时会把 {@code parser_config} 重置为该方法的默认模板
     * （raptor 变回 {@code {"use_raptor": false}}、graphrag 变回 {@code {"use_graphrag": false}}）。
     * 因此<b>每次 PUT 必须同时携带 {@code chunk_method} + 完整 {@code parser_config}</b>
     * （含 raptor + graphrag 子对象，布尔值按 MIS 开关原样下发 true/false），否则切过
     * 切片方式后 RAPTOR/图谱配置会被静默清空且 MIS 无从感知。
     *
     * <p><b>RAPTOR 子对象白名单（T00 P1a/P1b/P1g/P1i 实测，11 字段）：</b>MIS 只下发跟踪的
     * 5 字段：{@code use_raptor}(bool) / {@code max_token}(int, [1,2048] 合法但 MIS 校验
     * [512,2048]) / {@code threshold}(float, [0,1]) / {@code max_cluster}(int, [1,1024]) /
     * {@code prompt}(str, ≤2000，占位符不强制)。<b>U6 裁定：不暴露 {@code random_seed}</b>
     * ——引擎字段名是 {@code random_seed}（写 {@code seed} → code:101，T00 P1i 实测），
     * MIS 不下发该键，走引擎默认（0）。{@code clustering_method}/{@code scope}/
     * {@code tree_builder}/{@code auto_disable_for_structured_data}/{@code ext} 不暴露
     * （走引擎默认值）。未知键一律 code:101 被拒（P1d/P1e 实测），body 只放白名单键。
     *
     * <p><b>Wave B GraphRAG（T02）：</b>{@code parser_config.graphrag.use_graphrag}（布尔）
     * + {@code method}（light/graph）。P1c 实测 raptor + graphrag <b>可共存</b>（同体
     * code:0，回读双 true）——两个子对象每次都原样下发，互不覆盖。
     *
     * @param datasetId 原生 dataset id
     * @param settings  库级 RAG 设置（已 withDefaults，chunkMethod/useRaptor/useKnowledgeGraph 恒非空）
     */
    public void updateDatasetSettings(String datasetId, RagSettings settings) {
        Map<String, Object> body = new LinkedHashMap<>();
        // P1f：chunk_method + 完整 parser_config 恒下发——settings 为 null 时也按默认模板
        // 下发（use_raptor=false / use_graphrag=false + 默认 naive），保证每次 PUT 都带全配置，
        // 否则切过 chunk_method 后 raptor/graphrag 会被重置且 MIS 无从感知
        if (settings != null && settings.embeddingModel() != null && !settings.embeddingModel().isBlank()) {
            body.put("embedding_model", settings.embeddingModel());
        }
        // P1f：chunk_method 恒下发（withDefaults 后非空；空值兜底默认 naive，
        // 避免 null 被引擎当成「未设置」而走上一轮 chunk_method 的残留）
        body.put("chunk_method", settings != null && settings.chunkMethod() != null
                && !settings.chunkMethod().isBlank()
                ? settings.chunkMethod() : RagSettings.DEFAULT_CHUNK_METHOD);
        Map<String, Object> parserConfig = new LinkedHashMap<>();
        if (settings != null && settings.chunkTokenNum() != null) {
            parserConfig.put("chunk_token_num", settings.chunkTokenNum());
        }
        if (settings != null && settings.separator() != null && !settings.separator().isBlank()) {
            parserConfig.put("delimiter", settings.separator());
        }
        // P1f：完整 parser_config 恒下发——raptor 子对象（5 字段白名单）
        Map<String, Object> raptor = new LinkedHashMap<>();
        raptor.put("use_raptor", settings != null && Boolean.TRUE.equals(settings.useRaptor()));
        if (settings != null && settings.raptorMaxTokenNum() != null) {
            raptor.put("max_token", settings.raptorMaxTokenNum());
        }
        if (settings != null && settings.raptorThreshold() != null) {
            raptor.put("threshold", settings.raptorThreshold());
        }
        if (settings != null && settings.raptorMaxCluster() != null) {
            raptor.put("max_cluster", settings.raptorMaxCluster());
        }
        if (settings != null && settings.raptorPrompt() != null && !settings.raptorPrompt().isBlank()) {
            raptor.put("prompt", settings.raptorPrompt());
        }
        parserConfig.put("raptor", raptor);
        // P1f：完整 parser_config 恒下发——graphrag 子对象（布尔按 MIS 开关原样下发，
        // 防止 chunk_method 切换被重置后无法自愈；P1c 实测与 raptor 可共存）
        Map<String, Object> graphrag = new LinkedHashMap<>();
        graphrag.put("use_graphrag",
                settings != null && Boolean.TRUE.equals(settings.useKnowledgeGraph()));
        if (settings != null && Boolean.TRUE.equals(settings.useKnowledgeGraph())) {
            graphrag.put("method", GRAPH_METHOD_LIGHT);
        }
        parserConfig.put("graphrag", graphrag);
        body.put("parser_config", parserConfig);
        RfResponse<RfDataset> resp = putFor("/api/v1/datasets/" + datasetId, body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok()) {
            throw new BusinessException(50000, "RAGFlow 更新知识库设置失败: " + (resp == null ? "无响应" : resp.message()));
        }
    }

    /**
     * 删除 dataset（官方批量接口，增量 P0 / T01）。
     *
     * <p><b>改用 RAGFlow 官方批量接口（2026-08-12，实测 10.254.16.6:9380）：</b>
     * {@code DELETE /api/v1/datasets} + JSON body {@code {"ids":[datasetId]}}。
     * 旧实现走 {@code DELETE /api/v1/datasets/{id}} 单 id 路径，该实例返回
     * <b>405 MethodNotAllowed</b>——这正是知识库物理删除长期失效的根因（单 id 路径不被支持）。
     * 现改用官方批量接口，路径不带 {@code /{id}}，datasetId 放进 body 的 {@code ids} 数组。
     *
     * <p><b>Q1 missing 判定（2026-08-xx）：</b>原「404 静默幂等」改为「404 →
     * 抛 {@link EngineDatasetMissingException}」——运维可能已在 RAGFlow 控制台手工删除
     * 该 dataset，MIS 侧删除/归档时必须识别并提示，而不是把 404 当成「已删成功」静默吞掉。
     * 调用方（{@code KbLibraryService}）捕获后进入两段式确认流。
     *
     * <p><b>显式失败：</b>非 2xx 且非 404（含 405）一律抛 {@link BusinessException}，
     * 由调用方感知并回滚本地事务（保留历史「静默假成功」的修复）。不做「PUT enabled=0
     * 停用」冒充删除——停用语义已被 {@link #updateDocumentEnabled} 占用（B1），且停用 ≠ 删除。
     *
     * @param datasetId 原生 dataset id
     * @throws EngineDatasetMissingException 引擎侧 dataset 已不存在（HTTP 404）
     * @throws BusinessException             RAGFlow 返回非 2xx 且非 404 时抛出
     */
    public void deleteDataset(String datasetId) {
        if (datasetId == null || datasetId.isBlank()) {
            throw new BusinessException(50000, "RAGFlow 删除知识库失败: datasetId 为空");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ids", List.of(datasetId));
        deleteWithJsonBodyDetectMissing("/api/v1/datasets", body, "RAGFlow 删除知识库失败", 404);
    }

    /**
     * 重命名 dataset（归档流程的核心动作，引擎删除策略 P0 / T02）。
     *
     * <p>{@code PUT /api/v1/datasets/{id}}，body 只带 {@code {"name": name}}。
     * 复用 {@link #putFor} 与「{@code code != 0} 即抛异常」的统一口径——
     * 与 {@link #updateDatasetSettings} 同一个接口、同一套错误约定。
     *
     * <p><b>为什么归档要靠改名：</b>该 RAGFlow 版本的 {@code DELETE /datasets/{id}} 返回 405
     * （见 {@link #deleteDataset}），删不掉。改名是这个版本里唯一能在引擎控制台上
     * 一眼看出「这个库已经在 MIS 侧下线了」的手段，数据本身完整保留、可恢复。
     *
     * <p><b>Q1 missing 判定（2026-08-xx）：</b>引擎侧 dataset 已被手工删除时，改名会得到
     * HTTP 404 或 {@code code != 0} + 缺失文案（{@code not found / not exist / 不存在 / missing}）。
     * 这两种形态都抛 {@link EngineDatasetMissingException}，供归档两段式确认流识别——
     * 否则归档会因「改名失败」误落 {@code engine_sync_status=3} 等待对账，而正确语义是
     * 「引擎侧已不存在」。
     *
     * @param datasetId 原生 dataset id
     * @param name      新名字（已由 {@link RagflowDatasetNaming} 清洗并截断）
     * @throws EngineDatasetMissingException 引擎侧 dataset 已不存在（HTTP 404 / 缺失文案）
     * @throws BusinessException             参数非法或 RAGFlow 返回非 0 code（非 missing）
     */
    public void renameDataset(String datasetId, String name) {
        if (datasetId == null || datasetId.isBlank()) {
            throw new BusinessException(50000, "RAGFlow 重命名知识库失败: datasetId 为空");
        }
        if (name == null || name.isBlank()) {
            throw new BusinessException(50000, "RAGFlow 重命名知识库失败: 新名称为空");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("name", name);
        RfResponse<RfDataset> resp;
        try {
            resp = putFor("/api/v1/datasets/" + datasetId, body,
                    new ParameterizedTypeReference<>() {});
        } catch (RestClientResponseException ex) {
            int status = ex.getStatusCode().value();
            if (status == 404) {
                // 引擎侧 dataset 已不存在（可能在 RAGFlow 控制台被手工删除）→ missing 信号
                log.info("RAGFlow 重命名遇 HTTP 404（引擎侧数据集已不存在）datasetId={} newName={}",
                        datasetId, name);
                throw new EngineDatasetMissingException(
                        "RAGFlow 重命名知识库失败: HTTP 404 引擎侧数据集不存在");
            }
            throw new BusinessException(50000,
                    "RAGFlow 重命名知识库失败: HTTP " + status + " " + ex.getMessage());
        }
        if (resp == null || !resp.ok()) {
            if (resp != null && isDatasetMissingMessage(resp.message())) {
                // 业务 code != 0 且 message 命中缺失关键字 → missing 信号
                log.info("RAGFlow 重命名返回缺失文案（引擎侧数据集已不存在）datasetId={} newName={} msg={}",
                        datasetId, name, resp.message());
                throw new EngineDatasetMissingException(
                        "RAGFlow 重命名知识库失败: " + resp.message());
            }
            throw new BusinessException(50000,
                    "RAGFlow 重命名知识库失败: " + (resp == null ? "无响应" : resp.message()));
        }
    }

    /**
     * 分页列举 dataset（引擎对账用，引擎删除策略 P0 / T02）。
     *
     * <p>{@code GET /api/v1/datasets?page=&page_size=}，{@code page} 从 1 起
     * （与 {@link #listDocuments} 口径一致）。{@link #health()} 已经在用这个路径探活，
     * 证明其连通且鉴权有效，不需要再造第二个探测。
     *
     * <p><b>响应体做了双形态兼容</b>：不同 RAGFlow 版本的 {@code data} 有两种形态——
     * 数组（{@code data: [ {...} ]}，文档版本）与对象（{@code data: {kbs: [...], total: n}}，
     * 部分老版本）。本项目当前没有可用的联调环境去实测线上实例是哪一种，
     * 而一旦形态猜错，反序列化异常会让整个对账任务直接挂掉。故这里用 {@code JsonNode}
     * 解析并同时接住两种形态——比赌一把再等线上告警划算得多。
     *
     * @param page     页码，1-based（小于 1 按 1 处理）
     * @param pageSize 每页条数（小于 1 按 1 处理）
     * @return 该页的 dataset 列表，恒非 {@code null}（无数据返回空列表）
     * @throws BusinessException 无响应或 RAGFlow 返回非 0 code
     */
    public List<RfDataset> listDatasets(int page, int pageSize) {
        int safePage = Math.max(page, 1);
        int safeSize = Math.max(pageSize, 1);
        JsonNode root = client.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/datasets")
                        .queryParam("page", safePage)
                        .queryParam("page_size", safeSize)
                        .build())
                .header("Authorization", bearer())
                .retrieve()
                .body(JsonNode.class);
        if (root == null) {
            throw new BusinessException(50000, "RAGFlow 查询知识库列表失败: 无响应");
        }
        int code = root.path("code").asInt(-1);
        if (code != 0) {
            throw new BusinessException(50000,
                    "RAGFlow 查询知识库列表失败: code=" + code + " " + root.path("message").asText(""));
        }
        JsonNode datasets = resolveDatasetArray(root.path("data"));
        if (datasets == null || !datasets.isArray()) {
            return List.of();
        }
        List<RfDataset> result = new ArrayList<>(datasets.size());
        for (JsonNode node : datasets) {
            String id = text(node, "id");
            if (id == null || id.isBlank()) {
                // 没有 id 的行对账毫无意义（无法与 engine_library_ref join），直接跳过
                log.warn("RAGFlow 返回了缺少 id 的 dataset，已跳过: {}", node);
                continue;
            }
            result.add(new RfDataset(
                    id,
                    text(node, "name"),
                    intOrNull(node, "document_count"),
                    intOrNull(node, "chunk_count"),
                    longOrNull(node, "update_time")));
        }
        return result;
    }

    /**
     * 从 {@code data} 中取出 dataset 数组，兼容「数组」与「对象包裹」两种形态。
     *
     * @param data 响应体的 {@code data} 节点
     * @return 数组节点；无法识别时返回 {@code null}
     */
    private static JsonNode resolveDatasetArray(JsonNode data) {
        if (data == null || data.isNull() || data.isMissingNode()) {
            return null;
        }
        if (data.isArray()) {
            return data;
        }
        for (String key : new String[] {"kbs", "datasets", "items", "list"}) {
            JsonNode candidate = data.get(key);
            if (candidate != null && candidate.isArray()) {
                return candidate;
            }
        }
        return null;
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static Integer intOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() || !value.isNumber() ? null : value.asInt();
    }

    private static Long longOrNull(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() || !value.isNumber() ? null : value.asLong();
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
     * <p>官方 HTTP API：{@code DELETE /api/v1/datasets/{dataset_id}/documents}，
     * JSON body {@code {"ids":["docId"]}}。路径式
     * {@code DELETE .../documents/{docId}} 在本实例返回 <b>405</b>，旧实现还曾
     * {@code catch} 后继续删本地 → MIS 无文档、RAGFlow 仍在。
     *
     * <p>必须带非空 {@code ids} 且 {@code Content-Type: application/json}——部分版本
     * 无 body / 空 ids 会被当成删库内全部文档。
     *
     * <p>「停用」请用 {@link #updateDocumentEnabled}，不要把停用实现成删除。
     *
     * @param datasetId 原生 dataset id
     * @param docId     原生文档 id
     * @throws BusinessException 参数非法、HTTP 非 2xx，或 RAGFlow {@code code != 0}
     */
    public void deleteDocument(String datasetId, String docId) {
        if (datasetId == null || datasetId.isBlank()) {
            throw new BusinessException(50000, "RAGFlow 删除文档失败: datasetId 为空");
        }
        if (docId == null || docId.isBlank()) {
            throw new BusinessException(50000, "RAGFlow 删除文档失败: docId 为空");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("ids", List.of(docId));
        deleteWithJsonBody(
                "/api/v1/datasets/" + datasetId + "/documents",
                body,
                "RAGFlow 删除文档失败");
    }

    /**
     * DELETE 统一出口（无 body）：非 2xx（含 405）抛 {@link BusinessException}，不再静默。
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
     * DELETE + JSON body（文档删除 / 知识库批量删除等官方形态）。
     *
     * <p>HTTP 非 2xx 或业务 {@code code != 0} 均抛 {@link BusinessException}。
     *
     * <p><b>幂等语义：</b>{@code extraAcceptedStatuses} 用于删除类接口——落入其中的状态码
     * （如 404 表示资源已不在）视作删除成功、直接返回，不抛异常，便于重试。
     *
     * @param uri                  相对 baseUrl 的删除路径
     * @param body                 请求体（JSON）
     * @param failurePrefix        失败消息前缀（区分知识库/文档）
     * @param extraAcceptedStatuses 视为「成功」的额外 HTTP 状态码（幂等场景）
     */
    private void deleteWithJsonBody(String uri, Object body, String failurePrefix, int... extraAcceptedStatuses) {
        java.util.Set<Integer> accepted = extraAcceptedStatuses.length == 0
                ? java.util.Set.of() : new java.util.HashSet<>();
        for (int s : extraAcceptedStatuses) {
            accepted.add(s);
        }
        try {
            RfResponse<Object> resp = client.method(HttpMethod.DELETE)
                    .uri(uri)
                    .header("Authorization", bearer())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(new ParameterizedTypeReference<>() {});
            if (resp == null || !resp.ok()) {
                throw new BusinessException(50000,
                        failurePrefix + ": " + (resp == null ? "无响应" : resp.message()));
            }
        } catch (RestClientResponseException ex) {
            int status = ex.getStatusCode().value();
            if (accepted.contains(status)) {
                log.info("RAGFlow 删除遇 HTTP {}（视为已删除，幂等跳过）: {} body={}", status, uri, body);
                return;
            }
            throw new BusinessException(50000, failurePrefix + ": HTTP " + status + " " + ex.getMessage());
        }
    }

    /**
     * DELETE + JSON body 的「missing 检测」变体（Q1，仅供 {@link #deleteDataset} 使用）。
     *
     * <p>与 {@link #deleteWithJsonBody} 的唯一区别：{@code missingStatuses} 中的 HTTP 状态码
     * （如 404）<b>不再视作「幂等成功」</b>，而是抛 {@link EngineDatasetMissingException}——
     * 由调用方据此识别「引擎侧 dataset 已不存在」（运维可能已在 RAGFlow 控制台手工删除）。
     * 业务响应 {@code code != 0} 且 message 命中缺失关键字时同样抛 missing。
     *
     * <p><b>deleteDocument 的 404 语义不受影响：</b>文档删除仍走原
     * {@link #deleteWithJsonBody}（404 = 幂等成功），只有 dataset 删除需要 missing 信号。
     *
     * @param uri             相对 baseUrl 的删除路径
     * @param body            请求体（JSON）
     * @param failurePrefix   失败消息前缀（区分知识库/文档）
     * @param missingStatuses 视为「引擎侧缺失」的 HTTP 状态码（如 404）
     */
    private void deleteWithJsonBodyDetectMissing(
            String uri, Object body, String failurePrefix, int... missingStatuses) {
        java.util.Set<Integer> missing = missingStatuses.length == 0
                ? java.util.Set.of() : new java.util.HashSet<>();
        for (int s : missingStatuses) {
            missing.add(s);
        }
        try {
            RfResponse<Object> resp = client.method(HttpMethod.DELETE)
                    .uri(uri)
                    .header("Authorization", bearer())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(body)
                    .retrieve()
                    .body(new ParameterizedTypeReference<>() {});
            if (resp == null || !resp.ok()) {
                if (resp != null && isDatasetMissingMessage(resp.message())) {
                    log.info("RAGFlow 删除返回缺失文案（引擎侧数据集已不存在）: {} body={} msg={}",
                            uri, body, resp.message());
                    throw new EngineDatasetMissingException(failurePrefix + ": " + resp.message());
                }
                throw new BusinessException(50000,
                        failurePrefix + ": " + (resp == null ? "无响应" : resp.message()));
            }
        } catch (RestClientResponseException ex) {
            int status = ex.getStatusCode().value();
            if (missing.contains(status)) {
                log.info("RAGFlow 删除遇 HTTP {}（引擎侧数据集已不存在）: {} body={}", status, uri, body);
                throw new EngineDatasetMissingException(
                        failurePrefix + ": HTTP " + status + " 引擎侧数据集不存在");
            }
            throw new BusinessException(50000, failurePrefix + ": HTTP " + status + " " + ex.getMessage());
        }
    }

    /**
     * 业务响应 message 是否命中「引擎侧缺失」关键字（Q1 判定口径，不区分大小写）。
     *
     * @param message 引擎返回的 message，允许 {@code null}
     * @return {@code true} 表示命中 {@code not found / not exist / 不存在 / missing}
     */
    private static boolean isDatasetMissingMessage(String message) {
        if (message == null) {
            return false;
        }
        String lower = message.toLowerCase(Locale.ROOT);
        return lower.contains("not found")
                || lower.contains("not exist")
                || lower.contains("不存在")
                || lower.contains("missing");
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
     * 触发图谱构建（Wave B GraphRAG PoC，T02）。
     *
     * <p><b>T00 G2 实测契约：</b>{@code POST /api/v1/datasets/{id}/index?type=graph}
     * → {@code {"code":0,"data":{"task_id":"..."}}}。<b>type 值必须是 {@code graph}</b>
     * （{@link #INDEX_TYPE_GRAPH}），传 {@code graphrag} → code:102 拒绝。
     * 引擎侧只排队任务并立即返回 {@code task_id}，构图完成在后台进行。
     * 已有进行中任务（progress ∉ {-1,1}）时引擎会拒绝二次触发（MIS 侧状态机
     * {@code building} 已先行拦截，双保险）。
     *
     * @param datasetId 原生 dataset id
     * @return 引擎侧构图任务 id
     */
    public String buildGraph(String datasetId) {
        RfResponse<JsonNode> resp = postFor(
                "/api/v1/datasets/" + datasetId + "/index?type=" + INDEX_TYPE_GRAPH,
                Map.of(),
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null) {
            throw new BusinessException(50000,
                    "RAGFlow 触发图谱构建失败: " + (resp == null ? "无响应" : resp.message()));
        }
        String taskId = resp.data().path("task_id").asText(null);
        if (taskId == null || taskId.isBlank()) {
            throw new BusinessException(50000, "RAGFlow 触发图谱构建失败: 响应缺少 task_id");
        }
        log.info("RAGFlow 图谱构建已排队 datasetId={} taskId={}", datasetId, taskId);
        return taskId;
    }

    /**
     * 查询图谱构建状态（Wave B GraphRAG PoC，T02）。
     *
     * <p><b>T00 G3 实测契约：</b>{@code GET /api/v1/datasets/{id}/index?type=graph}
     * → {@code data} 为 task dict：{@code progress}（<b>1.0=完成 / -1=失败 / 其他=构建中</b>）、
     * {@code progress_msg}（构建日志）、{@code task_type="graphrag"}、
     * {@code process_duration}（秒）；<b>无任务时 {@code data}={}</b>（空对象）。
     *
     * <p>本方法只承载原生响应，progress → MIS 状态映射由
     * {@link com.mis.kb.domain.service.KbGraphService} 完成。
     *
     * @param datasetId 原生 dataset id
     * @return task dict（{@code data} 节点）；无任务时为空对象（非 null，调用方判空）
     */
    public JsonNode queryGraphBuildStatus(String datasetId) {
        JsonNode root = client.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/datasets/" + datasetId + "/index")
                        .queryParam("type", INDEX_TYPE_GRAPH)
                        .build())
                .header("Authorization", bearer())
                .retrieve()
                .body(JsonNode.class);
        if (root == null) {
            throw new BusinessException(50000, "RAGFlow 查询图谱构建状态失败: 无响应");
        }
        int code = root.path("code").asInt(-1);
        if (code != 0) {
            throw new BusinessException(50000,
                    "RAGFlow 查询图谱构建状态失败: code=" + code + " " + root.path("message").asText(""));
        }
        JsonNode data = root.path("data");
        return data == null || data.isNull() || data.isMissingNode() ? JsonNodeFactory.instance.objectNode() : data;
    }

    /**
     * 触发 RAPTOR 摘要构建（Wave C RAPTOR，T02）。
     *
     * <p><b>T00 P2a 实测契约：</b>{@code POST /api/v1/datasets/{id}/index?type=raptor}
     * → {@code {"code":0,"data":{"task_id":"..."}}}（与 graph 同构）。
     * 引擎侧只排队任务并立即返回 {@code task_id}，构建完成在后台进行。
     * graph/raptor <b>不互斥可并行</b>（T00 P2c 实测）；重复触发 raptor →
     * 引擎幂等跳过（{@code already has raptor RAPTOR chunks, skipping}），
     * MIS 侧状态机 {@code building} 已先行拦截，双保险。
     *
     * @param datasetId 原生 dataset id
     * @return 引擎侧 RAPTOR 构建任务 id
     */
    public String buildRaptor(String datasetId) {
        RfResponse<JsonNode> resp = postFor(
                "/api/v1/datasets/" + datasetId + "/index?type=" + INDEX_TYPE_RAPTOR,
                Map.of(),
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null) {
            throw new BusinessException(50000,
                    "RAGFlow 触发 RAPTOR 构建失败: " + (resp == null ? "无响应" : resp.message()));
        }
        String taskId = resp.data().path("task_id").asText(null);
        if (taskId == null || taskId.isBlank()) {
            throw new BusinessException(50000, "RAGFlow 触发 RAPTOR 构建失败: 响应缺少 task_id");
        }
        log.info("RAGFlow RAPTOR 构建已排队 datasetId={} taskId={}", datasetId, taskId);
        return taskId;
    }

    /**
     * 查询 RAPTOR 构建状态（Wave C RAPTOR，T02）。
     *
     * <p><b>T00 P2b 实测契约：</b>{@code GET /api/v1/datasets/{id}/index?type=raptor}
     * → {@code data} 为 task dict：{@code progress}（<b>1.0=完成 / -1=失败 / 其他=构建中</b>）、
     * {@code progress_msg}（构建日志）、{@code task_type="raptor"}、
     * {@code process_duration}（秒）；<b>无任务时 {@code data}={}</b>（空对象）——
     * 与 graph 完全同构。
     *
     * <p>本方法只承载原生响应，progress → MIS 状态映射由
     * {@link com.mis.kb.domain.service.KbRaptorService} 完成。
     *
     * @param datasetId 原生 dataset id
     * @return task dict（{@code data} 节点）；无任务时为空对象（非 null，调用方判空）
     */
    public JsonNode queryRaptorBuildStatus(String datasetId) {
        JsonNode root = client.get()
                .uri(uriBuilder -> uriBuilder
                        .path("/api/v1/datasets/" + datasetId + "/index")
                        .queryParam("type", INDEX_TYPE_RAPTOR)
                        .build())
                .header("Authorization", bearer())
                .retrieve()
                .body(JsonNode.class);
        if (root == null) {
            throw new BusinessException(50000, "RAGFlow 查询 RAPTOR 构建状态失败: 无响应");
        }
        int code = root.path("code").asInt(-1);
        if (code != 0) {
            throw new BusinessException(50000,
                    "RAGFlow 查询 RAPTOR 构建状态失败: code=" + code + " " + root.path("message").asText(""));
        }
        JsonNode data = root.path("data");
        return data == null || data.isNull() || data.isMissingNode() ? JsonNodeFactory.instance.objectNode() : data;
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
     * <p><b>企业级增强一期（KE-08/KE-09）：{@code document_ids} 下发。</b>
     * 实测（2026-08-11）：携带合法 {@code document_ids} → code:0 且只命中这些文档；
     * 携带不存在/越库 id → code:102（引擎校验归属）；空数组 → code:0 全量（空=不过滤）。
     * 因此 <b>MIS 侧解析结果为空时不下发该键</b>（R5），避免「空=全量」的歧义；
     * 非空才下发，且只允许本次检索库内的启用文档（由适配器 {@code resolveDocumentIds} 保证）。
     *
     * @param query       已由 {@code RetrieveQueryResolver} 合并完成的检索参数
     * @param datasetIds  原生 dataset id 列表
     * @param documentIds 引擎原生 document id 列表（文档过滤，KE-08/KE-09）；
     *                    空/非空见上方说明，空 = 不下发键（全量）
     * @return 原生 chunk 列表
     */
    public List<RfChunk> retrieve(RetrieveQuery query, List<String> datasetIds, List<String> documentIds) {
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
        // KE-08/KE-09：非空才下发 document_ids（R5：空 = 不下发键 = 全量）
        if (documentIds != null && !documentIds.isEmpty()) {
            body.put("document_ids", documentIds);
        }
        log.debug("RAGFlow 检索请求 datasets={} method={} keyword={} weight={} pageSize={} threshold={} "
                        + "rerankId={} documentIds={}",
                datasetIds, method, body.get("keyword"), body.get("vector_similarity_weight"),
                body.get("page_size"), body.get("similarity_threshold"),
                body.getOrDefault("rerank_id", "<未下发>"),
                body.getOrDefault("document_ids", "<未下发>"));

        RfResponse<RfRetrievalData> resp = postFor("/api/v1/retrieval", body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null) {
            throw new BusinessException(50000, "RAGFlow 检索失败: " + (resp == null ? "无响应" : resp.message()));
        }
        return resp.data().chunksOrEmpty();
    }

    /**
     * 单库图谱增强检索（Wave B GraphRAG PoC，T03）。
     *
     * <p><b>端点铁律：{@code POST /api/v1/datasets/{id}/search}，绝不走
     * {@code /api/v1/retrieval}</b>——T00 G5 实测（{@code ragflow-graphrag-probe-2026-08-11.md}）：
     * v0.26.4 对 {@code /api/v1/retrieval} 顶层未知字段 {@code use_kg} 静默忽略
     * （pydantic 丢弃，code:0 但无增强），这是最容易踩的「看似成功实则没加图」陷阱。
     *
     * <p><b>请求体映射（设计 §2.4 表）：</b>
     * <table border="1">
     *   <caption>MIS 参数 → /datasets/{id}/search 字段</caption>
     *   <tr><th>MIS 参数</th><th>字段</th><th>说明</th></tr>
     *   <tr><td>question</td><td>{@code question}</td><td>必填</td></tr>
     *   <tr><td>单库 datasetId</td><td>路径参数</td><td>不走 {@code dataset_ids}（避免多库 embedding 一致性限制）</td></tr>
     *   <tr><td>effectiveTopK</td><td>{@code size}</td><td>最终返回条数（与 /retrieval 的 page_size 语义一致）</td></tr>
     *   <tr><td>effectiveThreshold</td><td>{@code similarity_threshold}</td><td>同现状</td></tr>
     *   <tr><td>vectorSimilarityWeight</td><td>{@code vector_similarity_weight}</td><td>同现状</td></tr>
     *   <tr><td>retrievalMethod</td><td>{@code keyword}</td><td>同现状映射（hybrid→false）</td></tr>
     *   <tr><td>rerank</td><td>{@code rerank_mdl}</td><td>与现状 {@code rerank_id} 同值；开关为真且全局模型非空才下发</td></tr>
     *   <tr><td>useKnowledgeGraph</td><td>{@code use_kg: true}</td><td>图谱增强开关（本方法只被 effectiveUseKnowledgeGraph()==true 分支调用）</td></tr>
     *   <tr><td>documentIds</td><td>{@code doc_ids}</td><td><b>空 = 不下发键</b>（R5 同款：空 = 全量）；非空下发</td></tr>
     * </table>
     *
     * <p><b>与过滤参数共存（T00 G6 实测）：</b>{@code doc_ids} 与 {@code use_kg} 同请求体
     * 共存 ✓；传不存在的 doc → code:0 空结果（软过滤，无 /retrieval 的 code:102 硬校验）。
     *
     * @param datasetId   原生 dataset id（单库）
     * @param query       已由 {@code RetrieveQueryResolver} 合并完成的检索参数
     *                    （{@code effectiveUseKnowledgeGraph()} 已保证为 true）
     * @param documentIds 引擎原生 document id 列表（文档过滤，KE-08/KE-09）；空 = 不下发键（全量）
     * @return 原生 chunk 列表（{@link RfSearchChunk}）
     */
    public List<RfSearchChunk> searchDataset(String datasetId, RetrieveQuery query, List<String> documentIds) {
        String method = query.effectiveRetrievalMethod();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("question", query.question());
        body.put("use_kg", true);
        body.put("size", query.effectiveTopK());
        body.put("similarity_threshold", query.effectiveThreshold());
        body.put("keyword", mapRetrievalMethodToKeyword(method));
        body.put("vector_similarity_weight", mapRetrievalMethodToWeight(method, query));
        if (query.shouldSendRerankId()) {
            // /datasets/search 的重排字段是 rerank_mdl（与 /retrieval 的 rerank_id 同值）
            body.put("rerank_mdl", query.rerankModelId());
        }
        // G6：doc_ids 与 use_kg 同体；空 = 不下发键（R5：空 = 全量）
        if (documentIds != null && !documentIds.isEmpty()) {
            body.put("doc_ids", documentIds);
        }
        log.debug("RAGFlow 图谱增强检索 datasetId={} method={} keyword={} weight={} size={} "
                        + "threshold={} rerankMdl={} docIds={} useKg=true",
                datasetId, method, body.get("keyword"), body.get("vector_similarity_weight"),
                body.get("size"), body.get("similarity_threshold"),
                body.getOrDefault("rerank_mdl", "<未下发>"),
                body.getOrDefault("doc_ids", "<未下发>"));

        RfResponse<RfSearchData> resp = postFor("/api/v1/datasets/" + datasetId + "/search", body,
                new ParameterizedTypeReference<>() {});
        if (resp == null || !resp.ok() || resp.data() == null) {
            throw new BusinessException(50000,
                    "RAGFlow 图谱增强检索失败: " + (resp == null ? "无响应" : resp.message()));
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
