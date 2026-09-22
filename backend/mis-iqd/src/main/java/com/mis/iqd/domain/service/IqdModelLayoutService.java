package com.mis.iqd.domain.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.constant.SecurityConstants;
import com.mis.iqd.domain.entity.IqdModelLayout;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdModelLayoutRepository;
import com.mis.iqd.support.IdGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.request.RequestAttributes;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 建模台画布布局服务（v1.11 MR-S4 / 系统设计 §4.4 d 点；T03 实现）。
 *
 * <p><b>存储</b>：连接级单份 JSONB（{@code iqd_model_layout}，Q6 独立存储、不动 V71 表结构、
 * 不参与 MDL 派生 —— 「视图 / 模型分离」）。空布局约定返回
 * {@code {connection_id, nodes:[], edges:[], viewport:{x:0,y:0,zoom:1}, auto_layout_version:0, version:0}}。
 *
 * <p><b>权限</b>：{@code get} 需 {@code iqd:modeling:view}；{@code save} / {@code autoLayout}
 * 需 {@code iqd:modeling:edit}（A-11：拖拽坐标即写库，与节点编辑同语义）。
 *
 * <p><b>并发 / 体积</b>：{@code save} 以 {@code base_version} 做乐观并发（不符 → 40900 +
 * {@code data.current_version}）；布局体积上限 1MB（超限 → 42200）。
 *
 * <h2>A-02 裁决（本实现的选择）</h2>
 * <b>服务端不实现 dagre，{@code autoLayout} 抛 {@code UnsupportedOperationException}，
 * 由端点层转 HTTP 501。</b> 理由：
 * <ol>
 *   <li>{@code @dagrejs/dagre} 是**前端 npm 依赖**（system-design §7.1 已列），后端
 *       mis-iqd 无任何图布局库，也无既有可复用实现 —— 服务端实现等于新引一门依赖；</li>
 *   <li>布局是**纯视图数据**（Q6），计算位置与画布库（{@code @xyflow/react} 的节点尺寸/
 *       锚点/度量）强耦合，放前端算出的坐标与渲染结果天然自洽；放后端算则要复刻前端节点
 *       尺寸，易出现「算了但看起来不对」；</li>
 *   <li>一键整理的交互是**即时反馈**（MR-S4：200 节点 ≤2s），前端本地 dagre 无网络往返；</li>
 *   <li>落库路径完全复用本服务的 {@link #save}（前端算完 → {@code PUT /modeling/layout/{connId}}），
 *       不新增写路径、不破坏「编辑权威闭环」。</li>
 * </ol>
 * 端点保留（V88 已登记 92643 / 绑定 {@code iqd:modeling:edit}）以便未来做「服务端整库重排」，
 * 当前明确返回 501 + 说明文案，前端 {@code AutoLayoutButton} 应走**本地 dagre + PUT**。
 *
 * <p>返回类型用 {@code Map<String, Object>}（snake_case wire）而非独立 DTO：
 * 布局是纯视图数据、结构随前端画布库演进（沿用 T01 骨架的既定选择，
 * 亦与 {@code IqdCatalogNodeService.createModelFromTable} 返回 Map 同例）。
 */
@Service
public class IqdModelLayoutService {

    private static final Logger log = LoggerFactory.getLogger(IqdModelLayoutService.class);

    /** 布局 JSON 体积上限（1MB；超限 42200）。 */
    private static final int MAX_LAYOUT_BYTES = 1_048_576;

    /** 视图数据键（{@code layout_json} 内层容器）。 */
    private static final String LAYOUT_NODES = "nodes";
    private static final String LAYOUT_EDGES = "edges";

    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {};

    /** 布局仓储：{@code iqd_model_layout}（连接级唯一）。 */
    private final IqdModelLayoutRepository layoutRepository;

    /** 连接仓储：校验连接存在性（表有 FK，先校验给出可读业务码而非裸 FK 异常）。 */
    private final IqdConnectionRepository connectionRepository;

    /** 布局 JSONB 序列化 / 反序列化。 */
    private final ObjectMapper objectMapper;

    /** 变更事件（§8.3 {@code iqd.layout.changed} → 失效 layout 缓存）。 */
    private final IqdChangeEventPublisher changeEventPublisher;

    public IqdModelLayoutService(
            IqdModelLayoutRepository layoutRepository,
            IqdConnectionRepository connectionRepository,
            ObjectMapper objectMapper,
            IqdChangeEventPublisher changeEventPublisher) {
        this.layoutRepository = layoutRepository;
        this.connectionRepository = connectionRepository;
        this.objectMapper = objectMapper;
        this.changeEventPublisher = changeEventPublisher;
    }

    /**
     * 取连接级布局（无记录时返回空布局约定值，不落库、不报错）。
     *
     * @param connectionId 问数连接 id
     * @return {@code {connection_id, nodes, edges, viewport, auto_layout_version, version}}
     */
    @PreAuthorize("hasAuthority('iqd:modeling:view')")
    @Transactional(readOnly = true)
    public Map<String, Object> get(Long connectionId) {
        if (connectionId == null) {
            throw new BusinessException(42200, "connectionId 不能为空", null);
        }
        if (!connectionRepository.existsById(connectionId)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "问数连接不存在: " + connectionId);
        }
        Optional<IqdModelLayout> existing = layoutRepository.findByConnectionId(connectionId);
        if (existing.isEmpty()) {
            return emptyLayout(connectionId);
        }
        return toDto(connectionId, existing.get());
    }

    /**
     * 保存连接级布局（首次 insert，其后 update；{@code version} 单调 +1）。
     *
     * @param connectionId 问数连接 id
     * @param layout       布局 DTO（{@code {nodes, edges, viewport, auto_layout_version?, base_version?, version?}}）
     * @param baseVersion  乐观并发基线（null = 不校验；不符 → 40900 + {@code data.current_version}）
     * @return 保存后的布局（{@code version} 已 +1）
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    @Transactional
    public Map<String, Object> save(Long connectionId, Map<String, Object> layout, Integer baseVersion) {
        if (connectionId == null) {
            throw new BusinessException(42200, "connectionId 不能为空", null);
        }
        if (layout == null) {
            throw new BusinessException(42200, "layout 不能为空", null);
        }
        if (!connectionRepository.existsById(connectionId)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "问数连接不存在: " + connectionId);
        }

        // ---------- 体积上限（42200） ----------
        String wholeJson = writeJson(layout);
        int bytes = wholeJson.getBytes(StandardCharsets.UTF_8).length;
        if (bytes > MAX_LAYOUT_BYTES) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("limit_bytes", MAX_LAYOUT_BYTES);
            data.put("actual_bytes", bytes);
            throw new BusinessException(42200, "布局体积超过上限（1MB）", data);
        }

        // ---------- 乐观并发（40900） ----------
        Optional<IqdModelLayout> existing = layoutRepository.findByConnectionId(connectionId);
        int currentVersion = existing.map(e -> e.getLayoutVersion() == null ? 0 : e.getLayoutVersion()).orElse(0);
        if (existing.isPresent() && baseVersion != null && !baseVersion.equals(currentVersion)) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("current_version", currentVersion);
            throw new BusinessException(40900, "布局并发覆盖冲突：版本已变更", data);
        }

        // ---------- 落库 ----------
        Instant now = Instant.now();
        Map<String, Object> nodesEdges = new LinkedHashMap<>();
        nodesEdges.put(LAYOUT_NODES, orEmptyList(layout.get(LAYOUT_NODES)));
        nodesEdges.put(LAYOUT_EDGES, orEmptyList(layout.get(LAYOUT_EDGES)));

        IqdModelLayout entity = existing.orElseGet(IqdModelLayout::new);
        if (entity.getId() == null) {
            entity.setId(IdGenerator.nextId());
            entity.setConnectionId(connectionId);
        }
        int autoLayoutVersion = entity.getAutoLayoutVersion() == null
                ? toInt(layout.get("auto_layout_version"), 0)
                : entity.getAutoLayoutVersion();
        entity.setLayoutJson(writeJson(nodesEdges));
        entity.setViewportJson(layout.get("viewport") == null ? null : writeJson(layout.get("viewport")));
        entity.setAutoLayoutVersion(autoLayoutVersion);
        entity.setUpdatedBy(currentOperator());
        entity.setUpdatedAt(now);
        entity.setLayoutVersion(currentVersion + 1);
        layoutRepository.save(entity);

        changeEventPublisher.publish("iqd.layout.changed", "connection_id=" + connectionId);
        log.info("IQD layout saved connectionId={} version={} nodes={} edges={}",
                connectionId, entity.getLayoutVersion(),
                asListSize(layout.get(LAYOUT_NODES)), asListSize(layout.get(LAYOUT_EDGES)));

        return toDto(connectionId, entity);
    }

    /**
     * 一键自动布局 —— <b>服务端不实现</b>（A-02 裁决，见类注释）。
     *
     * <p>抛 {@code UnsupportedOperationException}，由 {@code IqdModelingController} 的
     * {@code POST /modeling/layout/{connectionId}/auto-layout} 端点翻译成 **HTTP 501 + 说明文案**：
     * 前端 {@code AutoLayoutButton} 在浏览器侧跑 {@code @dagrejs/dagre} 算坐标，
     * 再经 {@code PUT /modeling/layout/{connectionId}} 落库（复用 {@link #save}）。
     *
     * @param connectionId 问数连接 id
     * @param algorithm    算法与方向 {@code {algorithm:'dagre', direction:'LR'|'TB'}}
     * @return 永不返回（抛异常）
     */
    @PreAuthorize("hasAuthority('iqd:modeling:edit')")
    public Map<String, Object> autoLayout(Long connectionId, Map<String, Object> algorithm) {
        throw new UnsupportedOperationException(
                "服务端不实现自动布局（A-02）：@dagrejs/dagre 是前端依赖，布局计算需与画布节点度量保持一致。"
                        + "请在浏览器侧计算坐标后经 PUT /api/v1/iqd/modeling/layout/" + connectionId + " 落库。");
    }

    // ------------------------------------------------------------------ 内部

    /** 空布局（未保存过时 GET 的约定返回）。 */
    private static Map<String, Object> emptyLayout(Long connectionId) {
        Map<String, Object> viewport = new LinkedHashMap<>();
        viewport.put("x", 0);
        viewport.put("y", 0);
        viewport.put("zoom", 1);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("connection_id", connectionId);
        out.put(LAYOUT_NODES, List.of());
        out.put(LAYOUT_EDGES, List.of());
        out.put("viewport", viewport);
        out.put("auto_layout_version", 0);
        out.put("version", 0);
        return out;
    }

    /** 实体 → 出参（layout_json 拆回 nodes/edges；viewport_json 拆回 viewport）。 */
    private Map<String, Object> toDto(Long connectionId, IqdModelLayout entity) {
        Map<String, Object> layout = readJsonObject(entity.getLayoutJson());
        Map<String, Object> viewport = readJsonObject(entity.getViewportJson());

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("connection_id", connectionId);
        out.put(LAYOUT_NODES, layout.getOrDefault(LAYOUT_NODES, List.of()));
        out.put(LAYOUT_EDGES, layout.getOrDefault(LAYOUT_EDGES, List.of()));
        out.put("viewport", viewport == null ? defaultViewport() : viewport);
        out.put("auto_layout_version", entity.getAutoLayoutVersion() == null ? 0 : entity.getAutoLayoutVersion());
        out.put("version", entity.getLayoutVersion() == null ? 0 : entity.getLayoutVersion());
        return out;
    }

    private static Map<String, Object> defaultViewport() {
        Map<String, Object> viewport = new LinkedHashMap<>();
        viewport.put("x", 0);
        viewport.put("y", 0);
        viewport.put("zoom", 1);
        return viewport;
    }

    /** 序列化（失败按 42200 处理 —— 布局来自请求体，序列化失败说明入参含不可序列化值）。 */
    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exc) {
            log.warn("IQD layout serialize failed: {}", exc.getMessage());
            throw new BusinessException(42200, "布局序列化失败: " + exc.getMessage(), null);
        }
    }

    /** 反序列化为 JSON 对象（空 / 非法 → 空 Map；VIP 路径不因历史脏数据 500）。 */
    private Map<String, Object> readJsonObject(String json) {
        if (json == null || json.isBlank()) {
            return Map.of();
        }
        try {
            Map<String, Object> parsed = objectMapper.readValue(json, MAP_TYPE);
            return parsed == null ? Map.of() : parsed;
        } catch (Exception exc) {
            log.warn("IQD layout deserialize failed (fallback to empty): {}", exc.getMessage());
            return Map.of();
        }
    }

    private static Object orEmptyList(Object value) {
        return value instanceof List<?> ? value : new ArrayList<>();
    }

    private static int asListSize(Object value) {
        return value instanceof List<?> list ? list.size() : 0;
    }

    private static int toInt(Object value, int fallback) {
        if (value instanceof Number n) {
            return n.intValue();
        }
        if (value == null) {
            return fallback;
        }
        try {
            return Integer.parseInt(String.valueOf(value).trim());
        } catch (NumberFormatException exc) {
            return fallback;
        }
    }

    /**
     * 操作人标识（仅可观测，**非鉴权依据**）：取 BFF 透传的 {@code X-Username}，
     * 退而取 {@code X-User-Id}；无请求上下文（内部调用 / 单测）时返回 null。
     */
    private static String currentOperator() {
        try {
            RequestAttributes attrs = RequestContextHolder.getRequestAttributes();
            if (!(attrs instanceof ServletRequestAttributes servletAttrs)) {
                return null;
            }
            var request = servletAttrs.getRequest();
            String username = request.getHeader(SecurityConstants.HEADER_USERNAME);
            if (username != null && !username.isBlank()) {
                return username;
            }
            String userId = request.getHeader(SecurityConstants.HEADER_USER_ID);
            return (userId == null || userId.isBlank()) ? null : userId;
        } catch (Exception ignored) {
            return null;
        }
    }
}
