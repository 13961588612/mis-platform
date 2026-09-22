package com.mis.iqd.domain.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.iqd.api.dto.IqdAclSaveRequest;
import com.mis.iqd.api.dto.IqdAclVO;
import com.mis.iqd.api.dto.IqdAskLogVO;
import com.mis.iqd.api.dto.IqdCatalogItemSaveRequest;
import com.mis.iqd.api.dto.IqdCatalogItemVO;
import com.mis.iqd.api.dto.IqdConnectionSaveRequest;
import com.mis.iqd.api.dto.IqdConnectionUpdateRequest;
import com.mis.iqd.api.dto.IqdConnectionVO;
import com.mis.iqd.api.dto.IqdKnowledgeSaveRequest;
import com.mis.iqd.api.dto.IqdKnowledgeVO;
import com.mis.iqd.api.dto.IqdMaskRuleSaveRequest;
import com.mis.iqd.api.dto.IqdMaskRuleVO;
import com.mis.iqd.api.dto.IqdScopeDimensionVO;
import com.mis.iqd.api.dto.IqdScopePolicySaveRequest;
import com.mis.iqd.api.dto.IqdScopePolicyVO;
import com.mis.iqd.api.dto.IqdSqlPairSaveRequest;
import com.mis.iqd.api.dto.IqdSqlPairVO;
import com.mis.iqd.api.dto.IqdSyncJobVO;
import com.mis.iqd.domain.entity.IqdAskLog;
import com.mis.iqd.domain.entity.IqdCatalogItem;
import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.entity.IqdEditIdempotency;
import com.mis.iqd.domain.entity.IqdKnowledge;
import com.mis.iqd.domain.entity.IqdMaskRule;
import com.mis.iqd.domain.entity.IqdRowScopeDimension;
import com.mis.iqd.domain.entity.IqdScopePolicy;
import com.mis.iqd.domain.entity.IqdSqlPair;
import com.mis.iqd.domain.entity.IqdSyncJob;
import com.mis.iqd.domain.entity.IqdTableAcl;
import com.mis.iqd.domain.repository.IqdAskLogRepository;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdKnowledgeRepository;
import com.mis.iqd.domain.repository.IqdMaskRuleRepository;
import com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository;
import com.mis.iqd.domain.repository.IqdScopePolicyRepository;
import com.mis.iqd.domain.repository.IqdSqlPairRepository;
import com.mis.iqd.domain.repository.IqdSyncJobRepository;
import com.mis.iqd.domain.repository.IqdEditIdempotencyRepository;
import com.mis.iqd.domain.repository.IqdTableAclRepository;
import com.mis.iqd.support.IdGenerator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 问数管理服务（B2：连接配置 CRUD + 连通自检 + 审计写入；W2：清单/范围/ACL/脱敏/维度）。
 *
 * <p>连接配置只存 profile 名/连接标识，**不存 WrenAI 凭证**（凭证由 wren profile
 * 注入主机，见 deploy-iqd.md）。密钥字段 GET 恒回 ``******``，保存时提交非空才更新。
 *
 * <p>W2（B3）新增：
 * <ul>
 *   <li>清单 catalog：批量 upsert / MDL 快照同步 / 勾选纳入问数范围（in_scope ↔ scope_policy 一致）</li>
 *   <li>范围策略 scope_policy：批量幂等 upsert（global/role/dept/user/store）</li>
 *   <li>表级 ACL：批量幂等 upsert + 删除 + row_scope 维度实例读写/校验</li>
 *   <li>脱敏规则 mask_rule：按 name 幂等 upsert + 删除</li>
 *   <li>维度注册表 dimension：CRUD + enabled 开关</li>
 *   <li>变更事件：每次保存后发 {@code iqd.*.changed}（Worker 缓存刷新 ≤10s）</li>
 * </ul>
 */
@Service
public class IqdAdminService {

    private static final Logger log = LoggerFactory.getLogger(IqdAdminService.class);
    private static final String SECRET_PLACEHOLDER = "******";

    /**
     * 主连接标识（§14.5.1 A）：{@code name = 'default'} 即主连接。
     *
     * <p>单点常量 —— {@link #findPrimaryConnection()}（选择）与
     * {@link #updateConnection(Long, IqdConnectionUpdateRequest)}（改名迁移日志）共用，
     * 避免字面量 {@code "default"} 在多处漂移。
     */
    private static final String PRIMARY_CONNECTION_NAME = "default";

    private final IqdConnectionRepository connectionRepository;
    private final IqdAskLogRepository askLogRepository;
    private final IqdCatalogItemRepository catalogItemRepository;
    private final IqdScopePolicyRepository scopePolicyRepository;
    private final IqdTableAclRepository tableAclRepository;
    private final IqdMaskRuleRepository maskRuleRepository;
    private final IqdRowScopeDimensionRepository dimensionRepository;
    private final IqdSqlPairRepository sqlPairRepository;
    private final IqdKnowledgeRepository knowledgeRepository;
    private final IqdSyncJobRepository syncJobRepository;
    private final IqdEditIdempotencyRepository editIdempotencyRepository;
    private final IqdChangeEventPublisher changeEventPublisher;
    private final ObjectMapper objectMapper;

    public IqdAdminService(
            IqdConnectionRepository connectionRepository,
            IqdAskLogRepository askLogRepository,
            IqdCatalogItemRepository catalogItemRepository,
            IqdScopePolicyRepository scopePolicyRepository,
            IqdTableAclRepository tableAclRepository,
            IqdMaskRuleRepository maskRuleRepository,
            IqdRowScopeDimensionRepository dimensionRepository,
            IqdSqlPairRepository sqlPairRepository,
            IqdKnowledgeRepository knowledgeRepository,
            IqdSyncJobRepository syncJobRepository,
            IqdEditIdempotencyRepository editIdempotencyRepository,
            IqdChangeEventPublisher changeEventPublisher,
            ObjectMapper objectMapper) {
        this.connectionRepository = connectionRepository;
        this.askLogRepository = askLogRepository;
        this.catalogItemRepository = catalogItemRepository;
        this.scopePolicyRepository = scopePolicyRepository;
        this.tableAclRepository = tableAclRepository;
        this.maskRuleRepository = maskRuleRepository;
        this.dimensionRepository = dimensionRepository;
        this.sqlPairRepository = sqlPairRepository;
        this.knowledgeRepository = knowledgeRepository;
        this.syncJobRepository = syncJobRepository;
        this.editIdempotencyRepository = editIdempotencyRepository;
        this.changeEventPublisher = changeEventPublisher;
        this.objectMapper = objectMapper;
    }

    // ================================================================ 连接配置

    /**
     * 取连接配置（密钥恒回 ******）。
     *
     * @return 配置视图；无配置时返回空视图（enabled=false 占位）。
     */
    public IqdConnectionVO getConnection() {
        Optional<IqdConnection> existing = findPrimaryConnection();
        if (existing.isEmpty()) {
            IqdConnectionVO empty = new IqdConnectionVO();
            empty.setName("");
            empty.setEnabled(false);
            empty.setStatus("inactive");
            empty.setMdlWritebackEnabled(true);
            return empty;
        }
        return toVO(existing.get());
    }

    /**
     * 保存连接配置（upsert 单条主连接）。
     *
     * @param dto 保存请求（密钥非空才更新）
     * @return 保存后的配置视图
     */
    @Transactional
    public IqdConnectionVO saveConnection(IqdConnectionSaveRequest dto) {
        if (dto.getName() == null || dto.getName().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "连接名称不能为空");
        }
        Optional<IqdConnection> existing = findPrimaryConnection();
        IqdConnection entity = existing.orElseGet(IqdConnection::new);

        boolean isNew = entity.getId() == null;
        if (isNew) {
            entity.setId(IdGenerator.nextId());
            entity.setCreatedAt(Instant.now());
        }
        entity.setName(dto.getName().trim());
        entity.setBaseUrl(dto.getBaseUrl());
        if (dto.getAuthType() != null) {
            entity.setAuthType(dto.getAuthType());
        }
        // 密钥提交非空才更新（******/null 保留原值）
        if (dto.getSecretRef() != null && !dto.getSecretRef().isBlank()
                && !dto.isSecretPlaceholder()) {
            entity.setSecretRef(dto.getSecretRef().trim());
        }
        entity.setProjectId(dto.getProjectId());
        entity.setDefaultConnector(dto.getDefaultConnector());
        if (dto.getTimeoutSeconds() != null) {
            entity.setTimeoutSeconds(dto.getTimeoutSeconds());
        }
        if (dto.getLanguage() != null && !dto.getLanguage().isBlank()) {
            entity.setLanguage(dto.getLanguage());
        }
        entity.setEnabled(Boolean.TRUE.equals(dto.getEnabled()) ? 1 : 0);
        // 灰度闸门：写回 MDL 默认开启（U7/Q4）；仅显式 false 时关闭
        entity.setMdlWritebackEnabled(
                dto.getMdlWritebackEnabled() == null || Boolean.TRUE.equals(dto.getMdlWritebackEnabled()));
        // 保存后置为 inactive，待测试连通性
        entity.setStatus("inactive");
        entity.setUpdatedAt(Instant.now());

        connectionRepository.save(entity);
        changeEventPublisher.publish("iqd.config.changed", "connection=" + entity.getId());
        log.info("IQD connection saved id={} name={} isNew={}", entity.getId(), entity.getName(), isNew);
        return toVO(entity);
    }

    /**
     * 连通性自检（主连接）：GET {baseUrl}/health（短超时）。
     *
     * @return 自检结果（status/latency_ms/last_health_at）
     */
    @Transactional
    public Map<String, Object> testConnection() {
        Optional<IqdConnection> existing = findPrimaryConnection();
        if (existing.isEmpty()) {
            throw new BusinessException(ResultCode.NOT_FOUND, "尚未配置问数连接");
        }
        return probeHealth(existing.get());
    }

    // ---------------------------------------------------------------- v1.11 建模台：多连接（MR-01）

    /**
     * 全部连接清单（v1.11 建模台连接向导；含 MCP 运行态字段供状态卡渲染）。
     *
     * <p>与 {@link #getConnection()} 的区别：后者只回主连接；本方法回全量（按 id 升序，
     * 顺序稳定便于前端列表 diff）。凭证恒 {@code ******}（复用 {@link #toVO}）。
     *
     * @return 连接视图列表（无连接返回空列表）
     */
    @Transactional(readOnly = true)
    public List<IqdConnectionVO> listConnections() {
        List<IqdConnection> all = connectionRepository.findAll();
        all.sort(java.util.Comparator.comparing(IqdConnection::getId,
                java.util.Comparator.nullsLast(java.util.Comparator.naturalOrder())));
        List<IqdConnectionVO> out = new ArrayList<>(all.size());
        for (IqdConnection c : all) {
            out.add(toVO(c));
        }
        return out;
    }

    /**
     * 新建连接（v1.11 建模台；多连接，与 {@link #saveConnection} 的单条 upsert 不同）。
     *
     * <p>语义差异：{@code saveConnection} 是「主连接 upsert」（一期单连接形态，同 id 覆盖）；
     * 本方法是「追加一条新连接」（多连接列表），故必须做**同名冲突**校验 ——
     * {@code iqd_connection} 上 {@code uk_iqd_connection_name} 唯一，先查再插给出可读的
     * 40900 而非让数据库抛约束异常（后者会被降级成 50000 系统错误）。
     *
     * @param dto 连接保存请求（凭证非空才写入引用；GET 恒回 ******）
     * @return 新建后的连接视图
     */
    @Transactional
    public IqdConnectionVO createConnection(IqdConnectionSaveRequest dto) {
        if (dto == null || dto.getName() == null || dto.getName().isBlank()) {
            throw new BusinessException(42200, "连接名称不能为空", null);
        }
        String name = dto.getName().trim();
        if (connectionRepository.existsByName(name)) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("name", name);
            throw new BusinessException(40900, "连接名称已存在: " + name, data);
        }
        IqdConnection entity = new IqdConnection();
        entity.setId(IdGenerator.nextId());
        entity.setCreatedAt(Instant.now());
        entity.setName(name);
        entity.setBaseUrl(dto.getBaseUrl());
        if (dto.getAuthType() != null && !dto.getAuthType().isBlank()) {
            entity.setAuthType(dto.getAuthType());
        }
        if (dto.getSecretRef() != null && !dto.getSecretRef().isBlank() && !dto.isSecretPlaceholder()) {
            entity.setSecretRef(dto.getSecretRef().trim());
        }
        entity.setProjectId(dto.getProjectId());
        entity.setDefaultConnector(dto.getDefaultConnector());
        if (dto.getTimeoutSeconds() != null) {
            entity.setTimeoutSeconds(dto.getTimeoutSeconds());
        }
        if (dto.getLanguage() != null && !dto.getLanguage().isBlank()) {
            entity.setLanguage(dto.getLanguage());
        }
        entity.setEnabled(Boolean.TRUE.equals(dto.getEnabled()) ? 1 : 0);
        // 新建连接默认开启写回闸门（U7/Q4），显式 false 才关
        entity.setMdlWritebackEnabled(
                dto.getMdlWritebackEnabled() == null || Boolean.TRUE.equals(dto.getMdlWritebackEnabled()));
        entity.setStatus("inactive");
        entity.setMcpStatus("stopped");
        entity.setUpdatedAt(Instant.now());
        connectionRepository.save(entity);
        changeEventPublisher.publish("iqd.config.changed", "connection=" + entity.getId());
        log.info("IQD connection created id={} name={}", entity.getId(), entity.getName());
        return toVO(entity);
    }

    /**
     * 按 id 精确更新一条既有连接（**局部更新**；v1.11 T06 / system-design §14.1）。
     *
     * <p>与 {@link #saveConnection}（主连接 upsert：目标不存在则**新建**）的区别：本方法定位方式为
     * <b>显式路径 id</b>，目标不存在时<b>直接 42200 报错</b>（不隐式建）。
     *
     * <h2>有序校验链</h2>
     * <ol>
     *   <li>{@code id == null} → <b>42200</b>；</li>
     *   <li>{@code findById(id)} 不存在 → <b>42200</b>（对齐建模台节点族
     *       {@code IqdCatalogNodeService} 的「问数连接不存在」口径；<b>不用</b> 40400 —— 见 §14.1
     *       与 {@code testConnection(Long)} 已知不一致的裁决）；</li>
     *   <li>改名唯一：{@code newName} 非空、与原值不同、且 {@code existsByName(newName)} →
     *       <b>40900 + data.name</b>（复用 {@link #createConnection} 的「先查后报」范式，
     *       避免数据库抛 {@code uk_iqd_connection_name} 唯一约束异常被降级成 50000）；</li>
     *   <li>{@code timeout_seconds <= 0} → <b>42200</b>（失败零副作用，先于任何写入）；</li>
     *   <li>{@link #applyConnectionFields}（局部更新：{@code null} = 保留原值；{@code secret_ref}
     *       走占位符/空白 → 保留）；</li>
     *   <li>主连接迁移日志（§14.5.1 A）：改名使 {@code name} <b>离开</b>或<b>占用</b>
     *       {@code 'default'} 时打结构化日志 —— <b>不做任何跨行写</b>；</li>
     *   <li>{@code enabled} 只写<b>本行</b>（可多条同时 {@code true} 并存，§14.5）—— 无联动、无自动停用；</li>
     *   <li>{@code save} → {@code publish("iqd.config.changed")}；</li>
     *   <li><b>不 bump</b> {@code current_edit_revision}（连接配置不改模型，避免触发多余重建）。</li>
     * </ol>
     *
     * <p><b>并发</b>：无行版本 = last-write-wins（§14.4 —— 放开多条后无跨行不变量，故无串行化对象）。
     *
     * @param id  连接 id
     * @param dto 局部更新请求（字段全 {@code null} 默认）
     * @return 更新后的连接视图（**与 {@code GET /connections} 的元素逐字段同形**，
     *         服务层复用 {@link #toVO(IqdConnection)} ⇒ 前端可直接替换列表项）
     */
    @Transactional
    public IqdConnectionVO updateConnection(Long id, IqdConnectionUpdateRequest dto) {
        if (id == null) {
            throw new BusinessException(42200, "connectionId 不能为空", null);
        }
        IqdConnectionUpdateRequest req = dto == null ? new IqdConnectionUpdateRequest() : dto;
        IqdConnection entity = connectionRepository.findById(id)
                .orElseThrow(() -> new BusinessException(42200, "问数连接不存在: " + id, null));

        String originalName = entity.getName();

        // 3. 改名唯一校验（先查后报；同值改名跳过，避免误报 40900）
        if (req.getName() != null && !req.getName().isBlank()) {
            String newName = req.getName().trim();
            if (!newName.equals(originalName) && connectionRepository.existsByName(newName)) {
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("name", newName);
                throw new BusinessException(40900, "连接名称已存在: " + newName, data);
            }
        }

        // 4. timeout 预校验（> 0）：先于任何写入 ⇒ 失败零副作用
        if (req.getTimeoutSeconds() != null && req.getTimeoutSeconds() <= 0) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("field", "timeout_seconds");
            throw new BusinessException(42200, "超时秒数必须大于 0", data);
        }

        // 5. 局部更新：null = 保留原值
        applyConnectionFields(entity, req);

        // 6. 主连接迁移日志（name='default' 是主连接标识，§14.5.1 A）—— 只观测、不改其它行
        String newName = entity.getName();
        boolean leftPrimary = PRIMARY_CONNECTION_NAME.equals(originalName)
                && !PRIMARY_CONNECTION_NAME.equals(newName);
        boolean claimedPrimary = !PRIMARY_CONNECTION_NAME.equals(originalName)
                && PRIMARY_CONNECTION_NAME.equals(newName);
        if (leftPrimary) {
            log.info("primary migrated by rename: id={} old=default new={}", entity.getId(), newName);
        } else if (claimedPrimary) {
            log.info("primary claimed by rename: id={}", entity.getId());
        }

        entity.setUpdatedAt(Instant.now());
        // 7. 只写本行（无跨行联动、无悲观锁；enabled 可多条并存）
        connectionRepository.save(entity);
        // 8. 变更事件（Worker 缓存刷新 ≤10s）
        changeEventPublisher.publish("iqd.config.changed", "connection=" + entity.getId());
        log.info("IQD connection updated id={} name={}", entity.getId(), entity.getName());
        // 9/10. 不 bump current_edit_revision；响应复用 toVO（同形）
        return toVO(entity);
    }

    /**
     * 抽取连接字段写入块（局部更新语义）—— 供 {@link #updateConnection} 使用。
     *
     * <p>与 {@code saveConnection} / {@code createConnection} 的写入块**刻意分开**：
     * 后两者基于 {@link IqdConnectionSaveRequest}（带默认值，全量语义），本方法基于
     * {@link IqdConnectionUpdateRequest}（全 {@code null} 默认，局部语义），两者 DTO 与语义均不同，
     * 硬合并会让「未提交即保留」退化。故本方法**只被 {@code updateConnection} 调用**
     * （§14.10 第 6 项：为压缩回归风险，不改既有两条已验证写路径）。
     *
     * <p>规则（§14.1）：
     * <ul>
     *   <li>{@code name}：非空非空白 → 写 {@code trim} 值；否则保留原名；</li>
     *   <li>{@code base_url} / {@code project_id} / {@code default_connector}：{@code null} 保留，非空覆盖；</li>
     *   <li>{@code auth_type}：{@code null}/空白 = 缺省（保留）；否则覆盖；</li>
     *   <li>{@code language}：{@code null}/空白 = 缺省（保留）；否则覆盖；</li>
     *   <li>{@code timeout_seconds}：{@code null} 保留；非空覆盖（&gt; 0 已在调用方预校验）；</li>
     *   <li>{@code secret_ref}：{@code null} / 占位符 {@code ******} / 空白 → <b>保留</b>；
     *       非空非占位 → 写 {@code trim} 值（与 create 逐字一致）；</li>
     *   <li>{@code enabled}：{@code null} 保留；非空覆盖（只改本行，不联动其它）。</li>
     * </ul>
     *
     * @param entity 目标连接实体（就地更新）
     * @param dto    局部更新请求
     */
    private void applyConnectionFields(IqdConnection entity, IqdConnectionUpdateRequest dto) {
        if (dto.getName() != null && !dto.getName().isBlank()) {
            entity.setName(dto.getName().trim());
        }
        if (dto.getBaseUrl() != null) {
            entity.setBaseUrl(dto.getBaseUrl());
        }
        if (dto.getAuthType() != null && !dto.getAuthType().isBlank()) {
            entity.setAuthType(dto.getAuthType());
        }
        // 密钥提交非空且非占位符才更新（******/null/空白 保留原值）
        if (dto.getSecretRef() != null && !dto.getSecretRef().isBlank() && !dto.isSecretPlaceholder()) {
            entity.setSecretRef(dto.getSecretRef().trim());
        }
        if (dto.getProjectId() != null) {
            entity.setProjectId(dto.getProjectId());
        }
        if (dto.getDefaultConnector() != null) {
            entity.setDefaultConnector(dto.getDefaultConnector());
        }
        if (dto.getTimeoutSeconds() != null) {
            entity.setTimeoutSeconds(dto.getTimeoutSeconds());
        }
        if (dto.getLanguage() != null && !dto.getLanguage().isBlank()) {
            entity.setLanguage(dto.getLanguage());
        }
        if (dto.getEnabled() != null) {
            entity.setEnabled(Boolean.TRUE.equals(dto.getEnabled()) ? 1 : 0);
        }
    }

    /**
     * 连通性自检（按连接 id；v1.11 建模台连接向导「连通测试」步骤）。
     *
     * <p>出参按 system-design §3.3：{@code {ok, latency_ms, version}}（另附
     * {@code status/message/last_health_at} 便于前端状态卡直接渲染，不额外取数）。
     * 连接不可达时**不抛 50201**：连通测试的「失败」是正常业务结果（{@code ok=false}），
     * 抛异常会让前端把它当接口故障而非「这个连接连不上」。
     *
     * @param connectionId 连接 id
     * @return 自检结果
     */
    @Transactional
    public Map<String, Object> testConnection(Long connectionId) {
        if (connectionId == null) {
            throw new BusinessException(42200, "connectionId 不能为空", null);
        }
        IqdConnection entity = connectionRepository.findById(connectionId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "问数连接不存在: " + connectionId));
        Map<String, Object> probe = probeHealth(entity);
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", "active".equals(entity.getStatus()));
        out.put("latency_ms", probe.get("latency_ms"));
        out.put("version", null);
        out.put("status", entity.getStatus());
        out.put("message", entity.getLastHealthMsg());
        out.put("last_health_at", entity.getLastHealthAt());
        return out;
    }

    /**
     * 连通性探测公共实现（主连接 / 按 id 两条入口共用，避免两处漂移）。
     *
     * <p>探测目标 {@code GET {baseUrl}/health}（短超时 3s/5s）；结果回写
     * {@code status} / {@code last_health_at} / {@code last_health_msg}。
     *
     * @param entity 连接实体（就地更新并保存）
     * @return {@code {status, message, latency_ms, last_health_at}}
     */
    private Map<String, Object> probeHealth(IqdConnection entity) {
        String baseUrl = entity.getBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            entity.setStatus("inactive");
            entity.setLastHealthAt(Instant.now());
            entity.setLastHealthMsg("未配置 WrenAI 地址，请先保存连接配置");
            entity.setUpdatedAt(Instant.now());
            connectionRepository.save(entity);
            Map<String, Object> r = new LinkedHashMap<>();
            r.put("status", "inactive");
            r.put("message", entity.getLastHealthMsg());
            r.put("latency_ms", 0L);
            r.put("last_health_at", entity.getLastHealthAt());
            return r;
        }

        long start = System.currentTimeMillis();
        String healthUrl = baseUrl.replaceAll("/+$", "") + "/health";
        String status;
        String message;
        try {
            HttpClient client = HttpClient.newBuilder()
                    .connectTimeout(Duration.ofSeconds(3))
                    .build();
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(healthUrl))
                    .timeout(Duration.ofSeconds(5))
                    .GET()
                    .build();
            HttpResponse<String> resp = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (resp.statusCode() < 500) {
                status = "active";
                message = "连接正常 (HTTP " + resp.statusCode() + ")";
            } else {
                status = "error";
                message = "WrenAI 返回异常 (HTTP " + resp.statusCode() + ")";
            }
        } catch (Exception exc) {
            status = "error";
            message = "无法连接: " + exc.getClass().getSimpleName();
        }
        long latencyMs = System.currentTimeMillis() - start;

        entity.setStatus(status);
        entity.setLastHealthAt(Instant.now());
        entity.setLastHealthMsg(message);
        entity.setUpdatedAt(Instant.now());
        connectionRepository.save(entity);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", status);
        result.put("message", message);
        result.put("latency_ms", latencyMs);
        result.put("last_health_at", entity.getLastHealthAt());
        return result;
    }

    // ================================================================ 清单（catalog）

    /**
     * 查询连接下全部清单项（左树 + 右栏展示）。
     */
    @Transactional(readOnly = true)
    public List<IqdCatalogItemVO> listCatalog(Long connectionId) {
        return catalogItemRepository.findByConnectionId(connectionId).stream()
                .map(this::toCatalogVO)
                .toList();
    }

    /**
     * 查询纳入问数范围的清单项（in_scope=1；内部 API get-catalog-in-scope 数据源）。
     */
    @Transactional(readOnly = true)
    public List<IqdCatalogItemVO> listCatalogInScope(Long connectionId) {
        return catalogItemRepository.findByConnectionIdAndInScope(connectionId, 1).stream()
                .map(this::toCatalogVO)
                .toList();
    }

    /**
     * 批量 upsert 清单项（按 connection_id + item_key 幂等）。
     *
     * @return 实际写入行数
     */
    @Transactional
    public int saveCatalogBatch(Long connectionId, List<IqdCatalogItemSaveRequest> items) {
        if (connectionId == null || items == null || items.isEmpty()) {
            return 0;
        }
        ensureConnection(connectionId);
        Instant now = Instant.now();
        int count = 0;
        for (IqdCatalogItemSaveRequest dto : items) {
            if (dto.itemKey() == null || dto.itemKey().isBlank()) {
                continue;
            }
            Optional<IqdCatalogItem> existing =
                    catalogItemRepository.findByConnectionIdAndItemKey(connectionId, dto.itemKey());
            IqdCatalogItem entity = existing.orElseGet(IqdCatalogItem::new);
            boolean isNew = entity.getId() == null;
            if (isNew) {
                entity.setId(IdGenerator.nextId());
                entity.setConnectionId(connectionId);
                entity.setCreatedAt(now);
            }
            entity.setKind(defaultString(dto.kind(), "table"));
            entity.setParentKey(dto.parentKey());
            entity.setItemKey(dto.itemKey().trim());
            entity.setDisplayName(dto.displayName());
            entity.setDataType(dto.dataType());
            entity.setIsPrimaryKey(bool01(dto.isPrimaryKey()));
            entity.setIsTimeDimension(bool01(dto.isTimeDimension()));
            entity.setIsEmail(bool01(dto.isEmail()));
            entity.setDescription(dto.description());
            entity.setExpression(dto.expression());
            entity.setSource(defaultString(dto.source(), "db_meta"));
            entity.setInScope(bool01(dto.inScope()));
            entity.setSensitiveLevel(defaultString(dto.sensitiveLevel(), "none"));
            entity.setMaskRule(dto.maskRule());
            entity.setLastSeenAt(now);
            entity.setUpdatedAt(now);
            catalogItemRepository.save(entity);
            count++;
        }
        changeEventPublisher.publish("iqd.scope.changed", "catalog_batch=" + count);
        log.info("IQD catalog batch saved connectionId={} count={}", connectionId, count);
        return count;
    }

    /**
     * 从 WrenAI MDL 快照同步清单（get_mdl 产物；models/relationships/metrics/dimensions）。
     *
     * @return 同步写入行数
     */
    @Transactional
    public int syncCatalogFromMdl(Long connectionId, String mdlJson, String datasource, String schema) {
        if (mdlJson == null || mdlJson.isBlank()) {
            return 0;
        }
        ensureConnection(connectionId);
        // G7：以本次 WrenAI 同步原始 MDL 作为后续「平台编辑 → 派生完整 MDL」基线快照
        connectionRepository.findById(connectionId).ifPresent(c -> {
            c.setMdlRaw(mdlJson);
            c.setStaleDrift(false);
            c.setUpdatedAt(Instant.now());
            connectionRepository.save(c);
        });
        // Q2 重导入 = 新基线：清空历史 edit_revision / wren_ref_id（回归 WrenAI 镜像）
        catalogItemRepository.resetEditRevision(connectionId);

        List<IqdCatalogItemSaveRequest> items = new ArrayList<>();
        String ds = defaultString(datasource, "pg_main");
        String sch = defaultString(schema, "public");
        try {
            Map<String, Object> mdl = objectMapper.readValue(mdlJson, new TypeReference<>() {});
            List<Map<String, Object>> models = asList(mdl.get("models"));
            for (Map<String, Object> model : models) {
                String modelName = str(model.get("name"));
                if (modelName == null || modelName.isBlank()) {
                    continue;
                }
                String tableKey = ds + "." + sch + "." + modelName;
                items.add(new IqdCatalogItemSaveRequest(
                        "model", null, "mdl:model:" + modelName,
                        modelName, null, null, null, null,
                        str(model.get("description")), str(model.get("expression")), "mdl",
                        null, null, null));
                List<Map<String, Object>> columns = asList(model.get("columns"));
                for (Map<String, Object> col : columns) {
                    String colName = str(col.get("name"));
                    if (colName == null || colName.isBlank()) {
                        continue;
                    }
                    items.add(new IqdCatalogItemSaveRequest(
                            "column", tableKey, tableKey + "." + colName,
                            colName, str(col.get("type")), null, null, null,
                            str(col.get("description")), null, "mdl", null, null, null));
                }
            }
            List<Map<String, Object>> relationships = asList(mdl.get("relationships"));
            for (Map<String, Object> rel : relationships) {
                String relName = str(rel.get("name"));
                if (relName == null || relName.isBlank()) {
                    continue;
                }
                items.add(new IqdCatalogItemSaveRequest(
                        "relationship", null, "mdl:relationship:" + relName,
                        relName, null, null, null, null,
                        str(rel.get("description")), str(rel.get("expression")), "mdl",
                        null, null, null));
            }
            // cubes + measures[].name/description/expression（对齐 §八待明确事项 6）
            List<Map<String, Object>> cubes = asList(mdl.get("cubes"));
            for (Map<String, Object> cube : cubes) {
                String cubeName = str(cube.get("name"));
                if (cubeName == null || cubeName.isBlank()) {
                    continue;
                }
                String cubeKey = "mdl:cube:" + cubeName;
                items.add(new IqdCatalogItemSaveRequest(
                        "cube", null, cubeKey, cubeName, null, null, null, null,
                        str(cube.get("description")), str(cube.get("expression")), "mdl",
                        null, null, null));
                List<Map<String, Object>> measures = asList(cube.get("measures"));
                for (Map<String, Object> measure : measures) {
                    String measureName = str(measure.get("name"));
                    if (measureName == null || measureName.isBlank()) {
                        continue;
                    }
                    items.add(new IqdCatalogItemSaveRequest(
                            "measure", cubeKey, cubeKey + "." + measureName, measureName, null, null, null, null,
                            str(measure.get("description")), str(measure.get("expression")), "mdl",
                            null, null, null));
                }
            }
            // metrics
            List<Map<String, Object>> metrics = asList(mdl.get("metrics"));
            for (Map<String, Object> metric : metrics) {
                String metricName = str(metric.get("name"));
                if (metricName == null || metricName.isBlank()) {
                    continue;
                }
                items.add(new IqdCatalogItemSaveRequest(
                        "metric", null, "mdl:metric:" + metricName, metricName, null, null, null, null,
                        str(metric.get("description")), str(metric.get("expression")), "mdl",
                        null, null, null));
            }
            // dimensions
            List<Map<String, Object>> dimensions = asList(mdl.get("dimensions"));
            for (Map<String, Object> dim : dimensions) {
                String dimName = str(dim.get("name"));
                if (dimName == null || dimName.isBlank()) {
                    continue;
                }
                items.add(new IqdCatalogItemSaveRequest(
                        "dimension", null, "mdl:dimension:" + dimName, dimName, null, null, null, null,
                        str(dim.get("description")), str(dim.get("expression")), "mdl",
                        null, null, null));
            }
            // views
            List<Map<String, Object>> views = asList(mdl.get("views"));
            for (Map<String, Object> view : views) {
                String viewName = str(view.get("name"));
                if (viewName == null || viewName.isBlank()) {
                    continue;
                }
                items.add(new IqdCatalogItemSaveRequest(
                        "view", null, "mdl:view:" + viewName, viewName, null, null, null, null,
                        str(view.get("description")), str(view.get("expression")), "mdl",
                        null, null, null));
            }
        } catch (Exception exc) {
            log.warn("IQD mdl sync parse failed; skip error={}", exc.getMessage());
            return 0;
        }
        return saveCatalogBatch(connectionId, items);
    }

    /**
     * 勾选「纳入问数范围」：catalog in_scope 与 scope_policy global 行一致更新。
     *
     * @return 更新行数
     */
    @Transactional
    public int setCatalogInScope(Long connectionId, List<String> itemKeys, boolean inScope) {
        if (connectionId == null || itemKeys == null || itemKeys.isEmpty()) {
            return 0;
        }
        ensureConnection(connectionId);
        Instant now = Instant.now();
        int count = 0;
        for (String itemKey : itemKeys) {
            if (itemKey == null || itemKey.isBlank()) {
                continue;
            }
            Optional<IqdCatalogItem> existing =
                    catalogItemRepository.findByConnectionIdAndItemKey(connectionId, itemKey);
            if (existing.isPresent()) {
                existing.get().setInScope(inScope ? 1 : 0);
                existing.get().setUpdatedAt(now);
                catalogItemRepository.save(existing.get());
            }
            // scope_policy global 行同步（幂等 upsert）
            Optional<IqdScopePolicy> policy = scopePolicyRepository
                    .findByConnectionIdAndSubjectTypeAndSubjectIdAndItemKey(
                            connectionId, "global", "global", itemKey);
            IqdScopePolicy sp = policy.orElseGet(IqdScopePolicy::new);
            boolean isNew = sp.getId() == null;
            if (isNew) {
                sp.setId(IdGenerator.nextId());
                sp.setConnectionId(connectionId);
                sp.setSubjectType("global");
                sp.setSubjectId("global");
                sp.setItemKey(itemKey);
                sp.setCreatedAt(now);
            }
            sp.setAllow(inScope ? 1 : 0);
            sp.setEffective(1);
            sp.setUpdatedAt(now);
            scopePolicyRepository.save(sp);
            count++;
        }
        changeEventPublisher.publish("iqd.scope.changed", "in_scope=" + count);
        log.info("IQD catalog in-scope set connectionId={} count={} inScope={}",
                connectionId, count, inScope);
        return count;
    }

    // ================================================================ 范围策略

    /**
     * 查询连接下全部范围策略。
     */
    @Transactional(readOnly = true)
    public List<IqdScopePolicyVO> listScopePolicies(Long connectionId) {
        return scopePolicyRepository.findByConnectionId(connectionId).stream()
                .map(this::toScopePolicyVO)
                .toList();
    }

    /**
     * 批量保存范围策略（按 UK 幂等 upsert）。
     *
     * @return 写入行数
     */
    @Transactional
    public int saveScopePolicies(Long connectionId, List<IqdScopePolicySaveRequest> items) {
        if (connectionId == null || items == null || items.isEmpty()) {
            return 0;
        }
        ensureConnection(connectionId);
        Instant now = Instant.now();
        int count = 0;
        for (IqdScopePolicySaveRequest dto : items) {
            if (dto.itemKey() == null || dto.itemKey().isBlank()) {
                continue;
            }
            String subjectType = defaultString(dto.subjectType(), "global");
            String subjectId = defaultString(dto.subjectId(), "global");
            Optional<IqdScopePolicy> existing = scopePolicyRepository
                    .findByConnectionIdAndSubjectTypeAndSubjectIdAndItemKey(
                            connectionId, subjectType, subjectId, dto.itemKey());
            IqdScopePolicy sp = existing.orElseGet(IqdScopePolicy::new);
            boolean isNew = sp.getId() == null;
            if (isNew) {
                sp.setId(IdGenerator.nextId());
                sp.setConnectionId(connectionId);
                sp.setSubjectType(subjectType);
                sp.setSubjectId(subjectId);
                sp.setItemKey(dto.itemKey().trim());
                sp.setCreatedAt(now);
            }
            sp.setAllow(Boolean.TRUE.equals(dto.allow()) ? 1 : 0);
            sp.setEffective(dto.effective() == null || dto.effective() ? 1 : 0);
            sp.setRemark(dto.remark());
            sp.setUpdatedAt(now);
            scopePolicyRepository.save(sp);
            count++;
        }
        changeEventPublisher.publish("iqd.scope.changed", "policies=" + count);
        log.info("IQD scope policies saved connectionId={} count={}", connectionId, count);
        return count;
    }

    // ================================================================ 表级 ACL

    /**
     * 查询连接下全部表级 ACL。
     */
    @Transactional(readOnly = true)
    public List<IqdAclVO> listAcls(Long connectionId) {
        return tableAclRepository.findByConnectionId(connectionId).stream()
                .map(this::toAclVO)
                .toList();
    }

    /**
     * 批量保存表级 ACL（按 UK 幂等 upsert；row_scope 校验）。
     *
     * @return 写入行数
     */
    @Transactional
    public int saveAcls(Long connectionId, List<IqdAclSaveRequest> items) {
        if (connectionId == null || items == null || items.isEmpty()) {
            return 0;
        }
        ensureConnection(connectionId);
        Instant now = Instant.now();
        int count = 0;
        for (IqdAclSaveRequest dto : items) {
            if (dto.itemKey() == null || dto.itemKey().isBlank()) {
                continue;
            }
            String subjectType = defaultString(dto.subjectType(), "role");
            String subjectId = defaultString(dto.subjectId(), "");
            if (subjectId.isBlank()) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "ACL 主体不能为空");
            }
            String action = defaultString(dto.action(), "ask");
            if (!Set.of("ask", "manage").contains(action)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "ACL action 仅支持 ask/manage");
            }
            validateRowScope(dto.rowScope());

            Optional<IqdTableAcl> existing = tableAclRepository
                    .findByConnectionIdAndSubjectTypeAndSubjectIdAndItemKeyAndAction(
                            connectionId, subjectType, subjectId, dto.itemKey(), action);
            IqdTableAcl acl = existing.orElseGet(IqdTableAcl::new);
            boolean isNew = acl.getId() == null;
            if (isNew) {
                acl.setId(IdGenerator.nextId());
                acl.setConnectionId(connectionId);
                acl.setSubjectType(subjectType);
                acl.setSubjectId(subjectId);
                acl.setItemKey(dto.itemKey().trim());
                acl.setAction(action);
                acl.setCreatedAt(now);
            }
            acl.setRowScope(dto.rowScope());
            acl.setUpdatedAt(now);
            tableAclRepository.save(acl);
            count++;
        }
        changeEventPublisher.publish("iqd.acl.changed", "acls=" + count);
        log.info("IQD ACLs saved connectionId={} count={}", connectionId, count);
        return count;
    }

    /**
     * 删除单条 ACL。
     */
    @Transactional
    public void deleteAcl(Long id) {
        IqdTableAcl acl = tableAclRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "ACL 不存在"));
        tableAclRepository.delete(acl);
        changeEventPublisher.publish("iqd.acl.changed", "acl_deleted=" + id);
        log.info("IQD ACL deleted id={}", id);
    }

    /**
     * 校验 row_scope JSONB（W2：维度存在性 / 白名单语法）。
     *
     * @param rowScope JSONB 字符串（null/空 = 全行可见，合法）
     */
    public void validateRowScope(String rowScope) {
        if (rowScope == null || rowScope.isBlank()) {
            return;
        }
        try {
            Map<String, Object> parsed = objectMapper.readValue(
                    rowScope, new TypeReference<>() {});
            // 单维度或 dimensions 数组至少一个维度
            List<Map<String, Object>> dims = new ArrayList<>();
            Object dimensions = parsed.get("dimensions");
            if (dimensions instanceof List<?> list) {
                for (Object item : list) {
                    if (item instanceof Map<?, ?> m) {
                        @SuppressWarnings("unchecked")
                        Map<String, Object> mm = (Map<String, Object>) m;
                        dims.add(mm);
                    }
                }
            } else if (parsed.get("dimension") != null) {
                dims.add(parsed);
            }
            if (dims.isEmpty()) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "row_scope 至少需要一个维度");
            }
            for (Map<String, Object> dim : dims) {
                String code = str(dim.get("dimension"));
                if (code == null || code.isBlank()) {
                    throw new BusinessException(ResultCode.VALIDATION_ERROR, "row_scope 维度码不能为空");
                }
                if (!dimensionRepository.existsByDimensionCode(code)) {
                    throw new BusinessException(
                            ResultCode.VALIDATION_ERROR, "行级维度不存在: " + code);
                }
                String mode = str(dim.get("mode"));
                if ("manual".equalsIgnoreCase(mode)) {
                    validateManualParams(code, dim);
                }
            }
        } catch (BusinessException exc) {
            throw exc;
        } catch (Exception exc) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "row_scope 不是合法 JSON");
        }
    }

    /**
     * 校验手动模板参数：来源必须在维度注册表 param_whitelist 内且无危险语法。
     */
    private void validateManualParams(String dimensionCode, Map<String, Object> dim) {
        IqdRowScopeDimension dimEntity = dimensionRepository.findByDimensionCode(dimensionCode)
                .orElseThrow(() -> new BusinessException(
                        ResultCode.VALIDATION_ERROR, "行级维度不存在: " + dimensionCode));
        List<String> whitelist = parseWhitelist(dimEntity.getParamWhitelist());
        Object params = dim.get("params");
        if (!(params instanceof Map<?, ?> map)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "手动模式必须提供 params");
        }
        for (Map.Entry<?, ?> entry : map.entrySet()) {
            String key = String.valueOf(entry.getKey());
            if (!whitelist.contains(key)) {
                throw new BusinessException(
                        ResultCode.VALIDATION_ERROR,
                        "模板参数不在白名单内: " + key + "（允许: " + String.join(",", whitelist) + "）");
            }
            Object value = entry.getValue();
            if (value != null && String.valueOf(value).matches("(?i).*(;|--|/\\*|\\*/|\\b(select|insert|update|delete)\\b).*")) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "模板参数含危险语法");
            }
        }
    }

    // ================================================================ 脱敏规则

    /**
     * 查询全部脱敏规则（按 priority 升序）。
     */
    @Transactional(readOnly = true)
    public List<IqdMaskRuleVO> listMaskRules() {
        return maskRuleRepository.findByEnabledOrderByPriorityDesc(1).stream()
                .map(this::toMaskRuleVO)
                .toList();
    }

    /**
     * 保存脱敏规则（按 name 幂等 upsert）。
     */
    @Transactional
    public IqdMaskRuleVO saveMaskRule(IqdMaskRuleSaveRequest dto) {
        if (dto.name() == null || dto.name().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "规则名不能为空");
        }
        if (dto.pattern() == null || dto.pattern().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "匹配模式不能为空");
        }
        Optional<IqdMaskRule> existing = maskRuleRepository.findByName(dto.name());
        IqdMaskRule rule = existing.orElseGet(IqdMaskRule::new);
        boolean isNew = rule.getId() == null;
        if (isNew) {
            rule.setId(IdGenerator.nextId());
            rule.setCreatedAt(Instant.now());
        }
        rule.setName(dto.name().trim());
        rule.setMatchType(defaultString(dto.matchType(), "column_name"));
        rule.setPattern(dto.pattern());
        rule.setRule(defaultString(dto.rule(), "full"));
        rule.setReplacement(dto.replacement());
        rule.setPriority(dto.priority() == null ? 0 : dto.priority());
        rule.setEnabled(Boolean.TRUE.equals(dto.enabled()) ? 1 : 0);
        rule.setUpdatedAt(Instant.now());
        maskRuleRepository.save(rule);
        changeEventPublisher.publish("iqd.mask.changed", "rule=" + rule.getName());
        log.info("IQD mask rule saved name={} isNew={}", rule.getName(), isNew);
        return toMaskRuleVO(rule);
    }

    /**
     * 删除脱敏规则。
     */
    @Transactional
    public void deleteMaskRule(Long id) {
        IqdMaskRule rule = maskRuleRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "脱敏规则不存在"));
        maskRuleRepository.delete(rule);
        changeEventPublisher.publish("iqd.mask.changed", "rule_deleted=" + id);
        log.info("IQD mask rule deleted id={}", id);
    }

    // ================================================================ 维度注册表

    /**
     * 查询全部维度注册表（内部 API /get-dimensions 数据源）。
     */
    @Transactional(readOnly = true)
    public List<IqdScopeDimensionVO> listDimensions() {
        return dimensionRepository.findAllByOrderBySortAscIdAsc().stream()
                .map(this::toDimensionVO)
                .toList();
    }

    /**
     * 保存维度注册表条目（crud_dimension；按 dimension_code 幂等 upsert）。
     */
    @Transactional
    public IqdScopeDimensionVO saveDimension(Map<String, Object> dto) {
        String code = str(dto.get("dimension_code"));
        if (code == null || code.isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "维度码不能为空");
        }
        Optional<IqdRowScopeDimension> existing = dimensionRepository.findByDimensionCode(code);
        IqdRowScopeDimension dim = existing.orElseGet(IqdRowScopeDimension::new);
        boolean isNew = dim.getId() == null;
        if (isNew) {
            dim.setId(IdGenerator.nextId());
            dim.setCreatedAt(Instant.now());
        }
        dim.setDimensionCode(code);
        dim.setDimensionName(str(dto.get("dimension_name")) == null ? code
                : str(dto.get("dimension_name")));
        dim.setPredicateType(defaultString(str(dto.get("predicate_type")), "PATH_PREFIX"));
        dim.setColumnName(defaultString(str(dto.get("column_name")), code + "_id"));
        dim.setHeaderName(defaultString(str(dto.get("header_name")), "X-Mis-" + code));
        dim.setParamWhitelist(jsonOrNull(dto.get("param_whitelist")));
        dim.setDictTable(str(dto.get("dict_table")));
        dim.setAutoMode(bool01(dto.get("auto_mode") == null ? Boolean.TRUE : dto.get("auto_mode")));
        dim.setEnabled(bool01(dto.get("enabled") == null ? Boolean.TRUE : dto.get("enabled")));
        dim.setSort(dto.get("sort") instanceof Number n ? n.intValue() : 0);
        dim.setUpdatedAt(Instant.now());
        dimensionRepository.save(dim);
        changeEventPublisher.publish("iqd.dimension.changed", "dimension=" + code);
        log.info("IQD dimension saved code={} isNew={}", code, isNew);
        return toDimensionVO(dim);
    }

    /**
     * 删除维度注册表条目（enabled 开关替代硬删；硬删仅限未引用场景）。
     */
    @Transactional
    public void deleteDimension(Long id) {
        IqdRowScopeDimension dim = dimensionRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "维度不存在"));
        dimensionRepository.delete(dim);
        changeEventPublisher.publish("iqd.dimension.changed", "dimension_deleted=" + id);
        log.info("IQD dimension deleted id={}", id);
    }

    // ================================================================ 变更事件

    /**
     * 拉取自游标后的变更事件（Worker IqdConfigClient 增量拉取）。
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> drainChangeEvents(long sinceSeq) {
        return changeEventPublisher.drainSince(sinceSeq);
    }

    // ================================================================ 审计写入

    /**
     * 写问数审计日志（Worker 投影前调用，留全量 SQL）。
     *
     * @param payload wire 载荷（snake_case，与 Python AskLog payload 同构）
     * @return 落库后的日志行 id
     */
    @Transactional
    public Long writeAskLog(Map<String, Object> payload) {
        IqdAskLog logEntity = new IqdAskLog();
        logEntity.setId(IdGenerator.nextId());
        logEntity.setTraceId(str(payload.get("trace_id")));
        logEntity.setSessionId(str(payload.get("session_id")));
        logEntity.setThreadId(str(payload.get("thread_id")));
        logEntity.setQueryId(str(payload.get("query_id")));
        logEntity.setUserId(toLong(payload.get("user_id")));
        logEntity.setEmployeeId(str(payload.get("employee_id")));
        logEntity.setRoleCodes(jsonOrNull(payload.get("role_codes")));
        logEntity.setQuestion(str(payload.get("question")));
        logEntity.setResolvedScope(jsonOrNull(payload.get("resolved_scope")));
        logEntity.setStatus(str(payload.get("status")));
        logEntity.setWrenStatusTrail(jsonOrNull(payload.get("wren_status_trail")));
        logEntity.setSqlText(str(payload.get("sql_text")));
        logEntity.setSqlDialect(str(payload.get("sql_dialect")));
        logEntity.setSummary(str(payload.get("summary")));
        logEntity.setCitations(jsonOrNull(payload.get("citations")));
        logEntity.setPlanSteps(jsonOrNull(payload.get("plan_steps")));
        Integer rowCount = toInt(payload.get("row_count"));
        logEntity.setRowCount(rowCount);
        logEntity.setMaskedColumns(jsonOrNull(payload.get("masked_columns")));
        Long latencyMs = toLong(payload.get("latency_ms"));
        logEntity.setLatencyMs(latencyMs);
        logEntity.setErrorCode(str(payload.get("error_code")));
        logEntity.setErrorMessage(str(payload.get("error_message")));
        String viewMode = str(payload.get("view_mode"));
        logEntity.setViewMode(viewMode == null || viewMode.isBlank() ? "user" : viewMode);
        // B6 模拟角色审计留痕（有模拟则记录，无则 null；不改真实 user_id）
        logEntity.setSimulatedRoleCode(str(payload.get("simulated_role_code")));
        logEntity.setCreatedAt(Instant.now());
        logEntity.setUpdatedAt(Instant.now());

        askLogRepository.save(logEntity);
        log.info("IQD ask log written id={} queryId={} userId={}",
                logEntity.getId(), logEntity.getQueryId(), logEntity.getUserId());
        return logEntity.getId();
    }

    // ================================================================ 审计回查（W3）

    /**
     * 分页回查问数审计日志（W3 /traces）。
     *
     * @param limit  每页条数（缺省 50，上限 200）
     * @param status 状态过滤（可空）
     * @param userId 用户 id 过滤（可空）
     * @return 日志列表（按 id 倒序）
     */
    @Transactional(readOnly = true)
    public List<IqdAskLogVO> listAskLogs(Integer limit, String status, Long userId) {
        int capped = limit == null ? 50 : Math.min(Math.max(limit, 1), 200);
        List<IqdAskLog> entities;
        if (userId != null) {
            entities = askLogRepository.findByUserIdOrderByIdDesc(userId);
        } else if (status != null && !status.isBlank()) {
            entities = askLogRepository.findByStatusOrderByIdDesc(status);
        } else {
            entities = askLogRepository.findAll(
                    org.springframework.data.domain.Sort.by(org.springframework.data.domain.Sort.Direction.DESC, "id")
            ).stream().limit(capped).toList();
        }
        return entities.stream().limit(capped).map(this::toAskLogVO).toList();
    }

    /**
     * 取单条审计日志详情（W3 /traces/{id}）。
     */
    @Transactional(readOnly = true)
    public IqdAskLogVO getAskLog(Long id) {
        IqdAskLog entity = askLogRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "问数审计日志不存在: " + id));
        return toAskLogVO(entity);
    }

    // ================================================================ 样本对（W4）

    /**
     * 查询连接下的样本对（W4 /sql-pairs）。
     */
    @Transactional(readOnly = true)
    public List<IqdSqlPairVO> listSqlPairs(Long connectionId) {
        ensureConnection(connectionId);
        return sqlPairRepository.findByConnectionIdOrderByIdDesc(connectionId)
                .stream().map(this::toSqlPairVO).toList();
    }

    /**
     * 保存样本对（W4；v1.10 增 source_dialect / native_sql / wren_sql 字段持久化）。
     *
     * <p>幂等 upsert：dto.id 非空时按 id 更新（不存在抛 NOT_FOUND；连接不匹配抛
     * VALIDATION_ERROR）；dto.id 为空时按 连接+question+wren_sql 命中则更新、否则新建。
     */
    @Transactional
    public IqdSqlPairVO saveSqlPair(IqdSqlPairSaveRequest dto) {
        Long connectionId = dto.connectionId();
        if (connectionId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "connection_id 不能为空");
        }
        ensureConnection(connectionId);
        String question = dto.question() == null ? "" : dto.question().trim();
        String wrenSql = dto.wrenSql() == null ? "" : dto.wrenSql().trim();
        if (question.isEmpty() || wrenSql.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "question 与 wren_sql 不能为空");
        }
        IqdSqlPair pair;
        if (dto.id() != null) {
            pair = sqlPairRepository.findById(dto.id())
                    .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "样本对不存在: " + dto.id()));
            if (connectionId != null && !connectionId.equals(pair.getConnectionId())) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR, "样本对所属连接不匹配: " + dto.id());
            }
        } else {
            pair = sqlPairRepository
                    .findByConnectionIdAndQuestionAndWrenSql(connectionId, question, wrenSql)
                    .orElseGet(IqdSqlPair::new);
        }
        boolean isNew = pair.getId() == null;
        if (isNew) {
            pair.setId(IdGenerator.nextId());
            pair.setConnectionId(connectionId);
            pair.setSyncStatus("pending");
            pair.setCreatedAt(Instant.now());
        }
        pair.setQuestion(question);
        pair.setSourceDialect(dto.sourceDialect() == null ? null : dto.sourceDialect().trim());
        pair.setNativeSql(dto.nativeSql() == null ? null : dto.nativeSql());
        pair.setWrenSql(wrenSql);
        pair.setRemark(dto.remark());
        pair.setEnabled(dto.enabled() == null || dto.enabled() ? 1 : 0);
        pair.setUpdatedAt(Instant.now());
        sqlPairRepository.save(pair);
        if (isNew) {
            changeEventPublisher.publish("iqd.enhancement.changed", "sql_pair=" + pair.getId());
        }
        return toSqlPairVO(pair);
    }

    /**
     * 删除样本对（W4）。
     */
    @Transactional
    public void deleteSqlPair(Long id) {
        if (!sqlPairRepository.existsById(id)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "样本对不存在: " + id);
        }
        sqlPairRepository.deleteById(id);
        changeEventPublisher.publish("iqd.enhancement.changed", "sql_pair_deleted=" + id);
    }

    // ================================================================ 知识/术语（W4）

    /**
     * 查询连接下的知识/术语/口径（W4 /knowledge；kind 可空过滤）。
     */
    @Transactional(readOnly = true)
    public List<IqdKnowledgeVO> listKnowledge(Long connectionId, String kind) {
        ensureConnection(connectionId);
        List<IqdKnowledge> entities = (kind == null || kind.isBlank())
                ? knowledgeRepository.findByConnectionIdOrderByIdDesc(connectionId)
                : knowledgeRepository.findByConnectionIdAndKindOrderByIdDesc(connectionId, kind);
        return entities.stream().map(this::toKnowledgeVO).toList();
    }

    /**
     * 保存知识/术语/口径（W4；按连接+kind+title 幂等 upsert）。
     *
     * <p>T04d（PRD §5.2 e 点）：`related_item_keys` 为**应用层校验**的关联清单 —— 其 JSON 数组内的
     * 每个 `item_key` 必须存在于**本连接 catalog**，否则 `42200`（引用不存在的清单对象）。
     * 空 / 缺省 = 不关联（全连接通用），不校验。列已存在（V71:218 `related_item_keys JSONB`），
     * **不新增列/迁移**。
     */
    @Transactional
    public IqdKnowledgeVO saveKnowledge(IqdKnowledgeSaveRequest dto) {
        Long connectionId = dto.connectionId();
        if (connectionId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "connection_id 不能为空");
        }
        ensureConnection(connectionId);
        String kind = dto.kind() == null ? "" : dto.kind().trim();
        String title = dto.title() == null ? "" : dto.title().trim();
        if (kind.isEmpty() || title.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "kind 与 title 不能为空");
        }
        // T04d：关联对象必须真实存在于本连接 catalog（下拉即校验的权威侧）
        validateRelatedItemKeys(connectionId, dto.relatedItemKeys());
        IqdKnowledge knowledge = knowledgeRepository
                .findByConnectionIdAndKindAndTitle(connectionId, kind, title)
                .orElseGet(IqdKnowledge::new);
        boolean isNew = knowledge.getId() == null;
        if (isNew) {
            knowledge.setId(IdGenerator.nextId());
            knowledge.setConnectionId(connectionId);
            knowledge.setSource(dto.source() == null || dto.source().isBlank() ? "local" : dto.source());
            knowledge.setSyncStatus("pending");
            knowledge.setCreatedAt(Instant.now());
        }
        knowledge.setKind(kind);
        knowledge.setTitle(title);
        knowledge.setContent(dto.content());
        knowledge.setRelatedItemKeys(dto.relatedItemKeys());
        if (dto.source() != null && !dto.source().isBlank()) {
            knowledge.setSource(dto.source());
        }
        if (dto.kbTermId() != null && !dto.kbTermId().isBlank()) {
            knowledge.setKbTermId(dto.kbTermId());
        }
        knowledge.setEnabled(dto.enabled() == null || dto.enabled() ? 1 : 0);
        knowledge.setUpdatedAt(Instant.now());
        knowledgeRepository.save(knowledge);
        if (isNew) {
            changeEventPublisher.publish("iqd.enhancement.changed", "knowledge=" + knowledge.getId());
        }
        return toKnowledgeVO(knowledge);
    }

    /**
     * 校验 {@code related_item_keys}（T04d / PRD §5.2 e 点）。
     *
     * <p>入参是 wire 上的 **JSON 字符串数组**（如 {@code ["mdl:model:orders","mdl:cube:revenue"]}）。
     * 规则：
     * <ul>
     *   <li>空 / 缺省 / 空数组 → **不校验**（= 全连接通用，保持既有行为）；</li>
     *   <li>JSON 非法 → `42200`（`data.field=related_item_keys`）；</li>
     *   <li>数组中任一非空 `item_key` 不在本连接 catalog → `42200`（`data.missing` 列出缺失项）。</li>
     * </ul>
     * 放在 upsert **之前**：非法请求零副作用；失败即打回，不让脏关联落库（否则下发时
     * 该条目会被实际裁剪掉，却查不出原因 —— 静默失效）。
     *
     * @param connectionId      连接 id（已 ensureConnection）
     * @param relatedItemKeysJson 关联清单 JSON 字符串（可空）
     */
    private void validateRelatedItemKeys(Long connectionId, String relatedItemKeysJson) {
        if (relatedItemKeysJson == null || relatedItemKeysJson.isBlank()) {
            return;
        }
        List<String> keys;
        try {
            keys = objectMapper.readValue(relatedItemKeysJson, new TypeReference<>() {});
        } catch (Exception exc) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("field", "related_item_keys");
            throw new BusinessException(42200, "related_item_keys 不是合法的 JSON 字符串数组", data);
        }
        if (keys == null) {
            return;
        }
        List<String> requested = keys.stream()
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(k -> !k.isEmpty())
                .distinct()
                .toList();
        if (requested.isEmpty()) {
            return;
        }
        Set<String> existing = catalogItemRepository.findByConnectionId(connectionId).stream()
                .map(IqdCatalogItem::getItemKey)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        List<String> missing = requested.stream()
                .filter(k -> !existing.contains(k))
                .toList();
        if (!missing.isEmpty()) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("field", "related_item_keys");
            data.put("connection_id", connectionId);
            data.put("missing", missing);
            throw new BusinessException(42200, "related_item_keys 引用了不存在的清单对象", data);
        }
    }

    /**
     * 删除知识/术语/口径（W4）。
     */
    @Transactional
    public void deleteKnowledge(Long id) {
        if (!knowledgeRepository.existsById(id)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "知识条目不存在: " + id);
        }
        knowledgeRepository.deleteById(id);
        changeEventPublisher.publish("iqd.enhancement.changed", "knowledge_deleted=" + id);
    }

    /**
     * 从 S-07 平台术语表单向拉入知识（W4 /knowledge/import-s07；Q8）。
     *
     * <p>A6 未就绪时返回空结果（字段保留但不启用）；就绪后由部署侧适配器
     * 调用 S-07 只读接口，按 term 逐条 upsert（source=kb_s07，幂等）。
     *
     * @param connectionId 问数连接 id
     * @return 导入统计（imported / skipped）
     */
    @Transactional
    public Map<String, Object> importS07Knowledge(Long connectionId) {
        ensureConnection(connectionId);
        // 骨架：S-07 未就绪（A6）→ 空导入，保留能力位点
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("imported", 0);
        result.put("skipped", 0);
        result.put("message", "S-07 术语表未就绪（A6 保留位点），本次空导入");
        log.info("IQD S-07 knowledge import invoked connectionId={}", connectionId);
        return result;
    }

    /**
     * 标记待同步增强物料并返回（W4 /enhance/push 骨架；真实 push 由 Worker
     * 经 CLI context build 执行，mis-iqd 只负责登记 pending 状态）。
     *
     * @param connectionId 问数连接 id
     * @return 待推送物料统计与明细（sql_pairs + knowledge）
     */
    @Transactional(readOnly = true)
    public Map<String, Object> pushEnhancements(Long connectionId) {
        ensureConnection(connectionId);
        List<IqdSqlPair> pairs = sqlPairRepository
                .findByConnectionIdAndSyncStatus(connectionId, "pending")
                .stream().filter(p -> p.getEnabled() != null && p.getEnabled() == 1).toList();
        List<IqdKnowledge> knowledge = knowledgeRepository
                .findByConnectionIdAndSyncStatus(connectionId, "pending")
                .stream().filter(k -> k.getEnabled() != null && k.getEnabled() == 1).toList();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("sql_pairs", pairs.stream().map(this::toSqlPairVO).toList());
        result.put("knowledge", knowledge.stream().map(this::toKnowledgeVO).toList());
        result.put("sql_pair_count", pairs.size());
        result.put("knowledge_count", knowledge.size());
        result.put("message", "待推送物料已就绪（Worker 经 context build 同步并回填 wren_ref_id）");
        return result;
    }

    // ================================================================ 闭环补全（P0-3 / P1-1 / P1-2）

    /**
     * 回填增强物料：把本批 pending 物料的 {@code wren_ref_id}（= 本次 context build 的
     * mdl_hash）统一回填，并将 {@code sync_status} 置为 {@code synced} / {@code synced_at}。
     *
     * <p>由 ai-platform 经 {@code IqdConfigClient} 回调内部端点
     * {@code /internal/v1/iqd/enhance/backfill} 触达（对齐 write_ask_log 范式）。
     *
     * @param connectionId 连接 id
     * @param wrenRefId    context build 返回的 mdl_hash（或回退值 {@code wqd-*}）
     * @param sqlPairIds   本批 sql_pair 主键（可空）
     * @param knowledgeIds 本批 knowledge 主键（可空）
     * @param syncedAt     回填时间（ISO instant）
     * @return 实际回填行数
     */
    @Transactional
    public int backfillEnhancementSync(Long connectionId, String wrenRefId,
            List<Long> sqlPairIds, List<Long> knowledgeIds, Instant syncedAt) {
        if (connectionId == null || syncedAt == null) {
            return 0;
        }
        ensureConnection(connectionId);
        String ref = defaultString(wrenRefId, "");
        Instant at = syncedAt;
        int count = 0;

        List<Long> pairIds = sqlPairIds == null ? List.of() : sqlPairIds;
        if (!pairIds.isEmpty()) {
            for (IqdSqlPair p : sqlPairRepository.findAllById(pairIds)) {
                if (!connectionId.equals(p.getConnectionId())) {
                    continue;
                }
                p.setWrenRefId(ref);
                p.setSyncStatus("synced");
                p.setSyncedAt(at);
                p.setUpdatedAt(Instant.now());
                sqlPairRepository.save(p);
                count++;
            }
        }

        List<Long> knowIds = knowledgeIds == null ? List.of() : knowledgeIds;
        if (!knowIds.isEmpty()) {
            for (IqdKnowledge k : knowledgeRepository.findAllById(knowIds)) {
                if (!connectionId.equals(k.getConnectionId())) {
                    continue;
                }
                k.setWrenRefId(ref);
                k.setSyncStatus("synced");
                k.setSyncedAt(at);
                k.setUpdatedAt(Instant.now());
                knowledgeRepository.save(k);
                count++;
            }
        }

        if (count > 0) {
            changeEventPublisher.publish("iqd.enhancement.synced",
                    "connection=" + connectionId + " count=" + count);
        }
        log.info("IQD enhancement backfill connectionId={} wrenRefId={} pairs={} knowledge={} synced={}",
                connectionId, ref, pairIds.size(), knowIds.size(), count);
        return count;
    }

    /**
     * 上报同步作业（ai-platform 经 {@code IqdConfigClient} 回调
     * {@code /internal/v1/iqd/enhance/sync-job}）。
     *
     * <p>按连接覆盖写（一期每连接仅最新一条）：存在则更新，否则新建。
     * build/index 进入终态（success/failed）时分别打 build_at/index_at。
     *
     * @param payload snake_case 作业载荷（connection_id / build_status / build_mdl_hash /
     *                index_status / build_error / index_error / synced_sql_pair_count /
     *                synced_knowledge_count）
     * @return 落库后的作业视图
     */
    @Transactional
    public IqdSyncJobVO reportSyncJob(Map<String, Object> payload) {
        Long connectionId = toLong(payload.get("connection_id"));
        if (connectionId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "connection_id 不能为空");
        }
        ensureConnection(connectionId);
        Instant now = Instant.now();
        IqdSyncJob job = syncJobRepository.findTopByConnectionIdOrderByIdDesc(connectionId)
                .orElseGet(() -> {
                    IqdSyncJob j = new IqdSyncJob();
                    j.setId(IdGenerator.nextId());
                    j.setConnectionId(connectionId);
                    j.setCreatedAt(now);
                    return j;
                });
        job.setBuildStatus(defaultString(str(payload.get("build_status")), job.getBuildStatus()));
        String mdlHash = str(payload.get("build_mdl_hash"));
        if (mdlHash != null) {
            job.setBuildMdlHash(mdlHash);
        }
        job.setIndexStatus(defaultString(str(payload.get("index_status")), job.getIndexStatus()));
        if (isTerminalStatus(job.getBuildStatus())) {
            job.setBuildAt(now);
        }
        if (isTerminalStatus(job.getIndexStatus())) {
            job.setIndexAt(now);
        }
        Integer syncedPairs = toInt(payload.get("synced_sql_pair_count"));
        if (syncedPairs != null) {
            job.setSyncedSqlPairCount(syncedPairs);
        }
        Integer syncedKnow = toInt(payload.get("synced_knowledge_count"));
        if (syncedKnow != null) {
            job.setSyncedKnowledgeCount(syncedKnow);
        }
        job.setBuildError(str(payload.get("build_error")));
        job.setIndexError(str(payload.get("index_error")));
        // 自愈动作（force_rebuild / reindex / validate）；缺省保持 null 兼容历史 materials/model 作业
        job.setAction(str(payload.get("action")));
        job.setUpdatedAt(now);
        syncJobRepository.save(job);
        log.info("IQD sync job reported connectionId={} buildStatus={} indexStatus={} mdlHash={}",
                connectionId, job.getBuildStatus(), job.getIndexStatus(), job.getBuildMdlHash());
        return toSyncJobVO(job);
    }

    /**
     * 取连接最近一次同步作业（GET /api/v1/iqd/enhance/sync-status；无则 null）。
     */
    @Transactional(readOnly = true)
    public IqdSyncJobVO getLatestSyncJob(Long connectionId) {
        ensureConnection(connectionId);
        return syncJobRepository.findTopByConnectionIdOrderByIdDesc(connectionId)
                .map(this::toSyncJobVO)
                .orElse(null);
    }

    // ================================================================ 二期：语义模型编辑（P0-1~P0-12）

    /**
     * 编辑 catalog 节点（写回 MDL 前置：乐观并发 + 幂等 + 引用校验 + 字段级脱敏）。
     *
     * <p>流程：① 仅 {@code mdl_writeback_enabled=true} 连接允许写回；② 同
     * {@code idempotency_key} 命中即返回首次结果且不二次 bump；③ {@code base_revision}
     * 与连接当前版本不符 → 409；④ 改 display_name（即改名）且被直接引用 → 422；
     * ④b {@code patch.sensitive_level} 非 none/low/high → 422（T04b）；⑤ 否则
     * bump {@code current_edit_revision}、置 {@code edit_revision} 与 {@code source=platform_edit}。
     *
     * <p><b>patch 支持的键</b>：{@code display_name} / {@code description} / {@code expression}
     * / {@code sensitive_level}（none|low|high）/ {@code mask_rule}（字符串或 null=清除）。
     * T04b 增补后两者：使「字段级脱敏直编」（MR-13）走<b>本端点</b>（bump edit_revision、
     * 天然乐观并发 + 幂等），而非复用不写 edit_revision 的 batch 镜像路径。
     *
     * @return {@code {edit_revision, edit_status, wren_ref_id}}
     */
    @Transactional
    public Map<String, Object> updateCatalogNode(Long connectionId, String itemKey, String kind,
            Map<String, Object> patch, Long baseRevision, String idempotencyKey) {
        IqdConnection conn = connectionRepository.findById(connectionId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "问数连接不存在: " + connectionId));
        // ① 闸门：仅开启写回的连接允许真正 bump（U7/Q4 按连接灰度）
        if (!Boolean.TRUE.equals(conn.getMdlWritebackEnabled())) {
            throw new BusinessException(40300, "该连接未开启 MDL 写回（mdl_writeback_enabled=false）", null);
        }
        // ② 幂等去重：同 key 命中返回首次结果，不二次 bump（P0-12）
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            Optional<IqdEditIdempotency> prev = editIdempotencyRepository
                    .findByConnectionIdAndIdempotencyKey(connectionId, idempotencyKey);
            if (prev.isPresent()) {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("edit_revision", prev.get().getEditRevision());
                r.put("edit_status", "EDITED_UNSYNCED");
                r.put("wren_ref_id", null);
                return r;
            }
        }
        long current = conn.getCurrentEditRevision() == null ? 0L : conn.getCurrentEditRevision();
        // ③ 乐观并发：base_revision 不符即冲突（U2）
        if (baseRevision != null && !baseRevision.equals(current)) {
            Map<String, Object> data = new LinkedHashMap<>();
            data.put("current_edit_revision", current);
            throw new BusinessException(40900, "并发编辑冲突：当前版本已变更", data);
        }
        // 定位被编辑节点
        IqdCatalogItem item = catalogItemRepository.findByConnectionIdAndItemKey(connectionId, itemKey)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "catalog 节点不存在: " + itemKey));
        // ④ 改名（改 display_name）被直接引用 → 422（U1/Q3 仅直接引用方，不递归）
        if (patch != null && patch.containsKey("display_name")) {
            Object nextName = patch.get("display_name");
            boolean renamed = nextName != null && !String.valueOf(nextName).equals(item.getDisplayName());
            if (renamed) {
                List<Map<String, Object>> deps = validateCatalogRefs(connectionId, itemKey, "RENAME");
                if (!deps.isEmpty()) {
                    Map<String, Object> data = new LinkedHashMap<>();
                    data.put("dependents", deps);
                    throw new BusinessException(42200, "该节点被引用，禁止改名", data);
                }
            }
        }
        // ④b 脱敏字段枚举校验（T04b：patch.sensitive_level 只接受 none/low/high；非法 → 42200。
        //     必须在 bump 之前，避免「先 bump 后打回」——虽然本方法 @Transactional 会回滚，
        //     但把校验前置能保持「非法请求零副作用」这一更清晰的语义。）
        String nextSensitiveLevel = null;
        if (patch != null && patch.containsKey("sensitive_level")) {
            nextSensitiveLevel = normalizeSensitiveLevel(patch.get("sensitive_level"));
            if (nextSensitiveLevel == null) {
                Map<String, Object> data = new LinkedHashMap<>();
                data.put("field", "sensitive_level");
                throw new BusinessException(42200, "sensitive_level 只接受 none / low / high", data);
            }
        }
        // ⑤ bump 连接级版本并应用 patch
        long next = current + 1;
        conn.setCurrentEditRevision(next);
        connectionRepository.save(conn);

        if (patch != null) {
            if (patch.containsKey("display_name") && patch.get("display_name") != null) {
                item.setDisplayName(str(patch.get("display_name")));
            }
            if (patch.containsKey("description")) {
                item.setDescription(str(patch.get("description")));
            }
            if (patch.containsKey("expression")) {
                item.setExpression(str(patch.get("expression")));
            }
            // 字段级脱敏直编（T04b / MR-13）：与 mask_rule 一同落 iqd_catalog_item，
            // 使前端字段侧栏写入的是**优先级最高的字段级显式规则**（masking.py 规则链第 1/2 层），
            // 而非退到优先级最低的 iqd_mask_rule 规则表。
            // 说明：本方法在 ⑤ 已 bump edit_revision（乐观并发 + 幂等天然复用），
            // 故脱敏直编会正常进入 build（不同于不写 edit_revision 的 batch 镜像路径）。
            if (nextSensitiveLevel != null) {
                item.setSensitiveLevel(nextSensitiveLevel);
            }
            if (patch.containsKey("mask_rule")) {
                // null / 空串 → 清除字段级显式规则（列可空）
                String maskRule = str(patch.get("mask_rule"));
                item.setMaskRule(maskRule == null || maskRule.isBlank() ? null : maskRule);
            }
        }
        item.setSource("platform_edit");
        item.setEditRevision(next);
        item.setUpdatedAt(Instant.now());
        catalogItemRepository.save(item);

        // 记录幂等键（供重提交去重）
        if (idempotencyKey != null && !idempotencyKey.isBlank()) {
            editIdempotencyRepository.save(new IqdEditIdempotency(connectionId, idempotencyKey, next));
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("edit_revision", next);
        result.put("edit_status", "EDITED_UNSYNCED");
        result.put("wren_ref_id", null);
        return result;
    }

    /**
     * 校验 catalog 节点的直接引用方（不递归展开）。
     *
     * <p>扫描：① 同连接下 expression 含本 item_key 的 catalog 项（cube/relationship/
     * metric/dimension/view 等）；② 引用本 key 的 sql_pair（wren_sql/native_sql）；
     * ③ 关联本 key 的 knowledge（related_item_keys）。op∈{EDIT,DELETE,RENAME}。
     *
     * @return 直接引用方列表（{@code item_key, kind}），最多 50 条
     */
    @Transactional(readOnly = true)
    public List<Map<String, Object>> validateCatalogRefs(Long connectionId, String itemKey, String op) {
        ensureConnection(connectionId);
        List<Map<String, Object>> deps = new ArrayList<>();
        String needle = itemKey == null ? "" : itemKey;
        if (!needle.isEmpty()) {
            // ① catalog 项引用：expression 反向扫描（cube/relationship/metric/dimension/view 等）
            //    或 model_ref 直接命中（T03 起：cube 的所属模型独立成列，见 V89）
            for (IqdCatalogItem it : catalogItemRepository.findByConnectionId(connectionId)) {
                String expr = it.getExpression();
                String modelRef = it.getModelRef();
                boolean refByExpression = expr != null && expr.contains(needle);
                boolean refByModelRef = modelRef != null && modelRef.contains(needle);
                if (refByExpression || refByModelRef) {
                    Map<String, Object> d = new LinkedHashMap<>();
                    d.put("item_key", it.getItemKey());
                    d.put("kind", it.getKind());
                    deps.add(d);
                }
            }
            // ② sql_pair 引用
            for (IqdSqlPair p : sqlPairRepository.findByConnectionIdOrderByIdDesc(connectionId)) {
                String sql = (p.getWrenSql() == null ? "" : p.getWrenSql())
                        + " " + (p.getNativeSql() == null ? "" : p.getNativeSql());
                if (sql.contains(needle)) {
                    Map<String, Object> d = new LinkedHashMap<>();
                    d.put("item_key", "sql_pair:" + p.getId());
                    d.put("kind", "sql_pair");
                    deps.add(d);
                }
            }
            // ③ knowledge 引用
            for (IqdKnowledge k : knowledgeRepository.findByConnectionIdOrderByIdDesc(connectionId)) {
                String rk = k.getRelatedItemKeys();
                if (rk != null && rk.contains(needle)) {
                    Map<String, Object> d = new LinkedHashMap<>();
                    d.put("item_key", "knowledge:" + k.getId());
                    d.put("kind", "knowledge");
                    deps.add(d);
                }
            }
        }
        // 截断至 50 条（仅留直接引用方，不递归）
        if (deps.size() > 50) {
            deps = deps.subList(0, 50);
        }
        return deps;
    }

    /**
     * 按 revision 批量回填盖章（P0-8 / U8 断点续盖）：把本次 build 纳入的已编辑节点
     * （{@code edit_revision ≤ built 且未盖此 hash}）置 {@code wren_ref_id}，并推进连接级
     * {@code built_edit_revision / built_mdl_hash / stale_drift=false}（收敛）。
     *
     * @return 实际盖章节点数
     */
    @Transactional
    public int backfillCatalogSync(Long connectionId, String mdlHash, Long builtRevision) {
        int stamped = catalogItemRepository.stampCatalogSync(connectionId, mdlHash, builtRevision);
        connectionRepository.findById(connectionId).ifPresent(c -> {
            c.setBuiltEditRevision(builtRevision);
            c.setBuiltMdlHash(mdlHash);
            c.setStaleDrift(false);
            connectionRepository.save(c);
        });
        return stamped;
    }

    /**
     * 取连接级编辑同步状态（前端 CatalogSyncStatusBar 渲染）。
     *
     * <p>返回 8 字段：connection_id / current_edit_revision / built_edit_revision /
     * edit_status / build_status / index_status / mdl_hash / stale_drift。
     * edit_status 派生（不落库）：STALE_DRIFT / EDITED_UNSYNCED / SYNCING /
     * SYNC_FAILED / SYNCED。
     */
    @Transactional(readOnly = true)
    public Map<String, Object> getCatalogSyncStatus(Long connectionId) {
        IqdConnection conn = connectionRepository.findById(connectionId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "问数连接不存在: " + connectionId));
        IqdSyncJob latest = syncJobRepository.findTopByConnectionIdOrderByIdDesc(connectionId).orElse(null);
        long cur = conn.getCurrentEditRevision() == null ? 0L : conn.getCurrentEditRevision();
        long built = conn.getBuiltEditRevision() == null ? 0L : conn.getBuiltEditRevision();

        String editStatus;
        if (Boolean.TRUE.equals(conn.getStaleDrift())) {
            editStatus = "STALE_DRIFT";
        } else if (cur > built) {
            editStatus = "EDITED_UNSYNCED";
        } else if (latest != null && "failed".equals(latest.getBuildStatus())) {
            editStatus = "SYNC_FAILED";
        } else if (latest != null && "running".equals(latest.getBuildStatus())) {
            editStatus = "SYNCING";
        } else {
            editStatus = "SYNCED";
        }

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("connection_id", conn.getId());
        m.put("current_edit_revision", cur);
        m.put("built_edit_revision", built);
        m.put("edit_status", editStatus);
        m.put("build_status", latest == null ? null : latest.getBuildStatus());
        m.put("index_status", latest == null ? null : latest.getIndexStatus());
        m.put("mdl_hash", conn.getBuiltMdlHash());
        m.put("stale_drift", Boolean.TRUE.equals(conn.getStaleDrift()));
        return m;
    }

    /**
     * 触发对账（重新导入收敛）：清空外部漂移标记，交由编排层（BFF / ai-platform）按
     * model 范围重建并回写（S3 / Q2）。
     *
     * @return {@code {triggered:true}}
     */
    @Transactional
    public Map<String, Object> reconcileCatalog(Long connectionId) {
        ensureConnection(connectionId);
        connectionRepository.setStaleDrift(connectionId, false);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("triggered", true);
        return m;
    }

    /**
     * 外部漂移探测：平台期望 MDL 与 WrenAI 实际部署是否背离。
     *
     * <p>mis-iqd 不直接调 WrenAI；漂移精确判定由 ai-platform
     * {@code IqdCli.get_current_mdl_hash} 比对 {@code built_mdl_hash} 完成，命中后回调
     * {@code /enhance/drift}。本方法提供「是否需要重新对账」的粗判定
     * （stale_drift 标记 或 存在未同步编辑），供内部探测与诊断。
     */
    @Transactional(readOnly = true)
    public boolean checkExternalDrift(Long connectionId) {
        IqdConnection conn = connectionRepository.findById(connectionId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "问数连接不存在: " + connectionId));
        long cur = conn.getCurrentEditRevision() == null ? 0L : conn.getCurrentEditRevision();
        long built = conn.getBuiltEditRevision() == null ? 0L : conn.getBuiltEditRevision();
        return Boolean.TRUE.equals(conn.getStaleDrift()) || cur > built;
    }

    /**
     * 取连接完整 MDL 快照 + 已编辑节点（供 ai-platform G7 派生完整 MDL）。
     *
     * <p>返回 {@code {connection_id, mdl_raw, edited_items[], current_edit_revision,
     * built_edit_revision}}：mdl_raw 为最近一次 WrenAI 同步基线快照（JSON 字符串）；
     * edited_items 为 {@code edit_revision} 非空的平台编辑节点（{@code item_key, kind,
     * parent_key, display_name, data_type, description, expression, model_ref}）；
     * current_edit_revision / built_edit_revision
     * 为连接级编辑版本（设计 §九.1 / §7.2），build 成功回填时 ai-platform 取
     * current_edit_revision 作为 {@code edit_revision} 传入 backfillCatalogSync（WHERE
     * {@code edit_revision <= :built} 命中已编辑节点，推进 SYNCED 状态机）。mdl_raw 为空时
     * 调用方降级为「仅从 edited_items 重建」。
     */
    @Transactional(readOnly = true)
    public Map<String, Object> getCatalogFull(Long connectionId) {
        IqdConnection conn = connectionRepository.findById(connectionId)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND,
                        "问数连接不存在: " + connectionId));
        List<Map<String, Object>> edited = new ArrayList<>();
        for (IqdCatalogItem it : catalogItemRepository.findEditedItems(connectionId)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("item_key", it.getItemKey());
            m.put("kind", it.getKind());
            m.put("parent_key", it.getParentKey());
            m.put("display_name", it.getDisplayName());
            m.put("data_type", it.getDataType());
            m.put("description", it.getDescription());
            m.put("expression", it.getExpression());
            // T03：cube 的所属模型独立成列（V89 model_ref），派生侧据此写回 MDL 的 baseObject
            m.put("model_ref", it.getModelRef());
            edited.add(m);
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("connection_id", conn.getId());
        body.put("mdl_raw", conn.getMdlRaw());
        body.put("edited_items", edited);
        // 连接级编辑版本：与 getCatalogSyncStatus（T03）契约命名一致，供 ai-platform
        // trigger_model_build 取 current_edit_revision 回填断点续盖（见设计 §九.1 / §7.2）。
        body.put("current_edit_revision", conn.getCurrentEditRevision());
        body.put("built_edit_revision", conn.getBuiltEditRevision());
        return body;
    }

    /**
     * 置外部漂移标记（S3：ai-platform 漂移检测命中回调）。
     */
    @Transactional
    public void setStaleDrift(Long connectionId, boolean drift) {
        ensureConnection(connectionId);
        connectionRepository.setStaleDrift(connectionId, drift);
    }

    /**
     * 回写连接级 WrenAI MCP 进程状态（方案 A 多连接可观测，REQ-P1-2）。
     *
     * <p>由 ai-platform Worker 进程管理器（WrenMcpProcessManager）在启停/健康自检后
     * 经内部端点回调。仅回写进程管理器掌握的 {@code mcp_status} / {@code mcp_port}，
     * 不影响其它连接字段。
     *
     * @param connectionId 问数连接 id
     * @param mcpStatus    MCP 进程状态（running/stopped/starting/crashed/unhealthy）
     * @param mcpPort      MCP 进程监听端口（进程未启动可为 null）
     */
    @Transactional
    public void reportMcpStatus(Long connectionId, String mcpStatus, Integer mcpPort) {
        ensureConnection(connectionId);
        connectionRepository.setMcpStatus(connectionId, mcpStatus, mcpPort);
    }

    /**
     * 回写连接级 WrenAI MCP 跨机器部署句柄（方案 A 跨机器落地 v0.2）。
     *
     * <p>由 ai-platform Worker 在经 {@code WrenMcpAgentClient.ensure} 拉起 wren 机部署后回调，
     * 把数据面 {@code mcp_host} / {@code agent_handle} / {@code mcp_status} 写回
     * iqd_connection，供前端/可观测定位跨机器部署位置。仅存引用，不存凭证明文
     * （决策 ③ S1：wren 机不接 Vault，凭证仅经控制面一次性推送注入子进程 env）。
     *
     * @param connectionId 问数连接 id
     * @param mcpHost      agent 数据面可达 host（ai-platform 侧视角，如 http://10.x:9101）
     * @param agentHandle  WrenMcpAgent 部署句柄（control 通道路由定位）
     * @param mcpStatus    MCP 进程状态（running/stopped/starting/crashed/unhealthy）
     */
    @Transactional
    public void reportMcpDeployment(Long connectionId, String mcpHost, String agentHandle, String mcpStatus) {
        ensureConnection(connectionId);
        connectionRepository.setMcpDeployment(connectionId, mcpHost, agentHandle, mcpStatus);
    }

    /**
     * 取连接凭证引用（方案 A 多连接 D6 凭证解析前置）。
     *
     * <p><b>仅回 {@code secret_ref}（opaque vault 引用），绝不回明文/密码</b>。ai-platform
     * 经此引用调本地 {@code CredentialVault} 解密后注入 wren serve mcp 进程 env（不落盘），
     * 与 mis-iqd 不持有业务库凭证的铁律一致（见 IqdConnection 类注释）。
     *
     * @param connectionId 问数连接 id
     * @return {@code {connection_id, secret_ref}}（secret_ref 缺失时为 null）
     */
    public Map<String, Object> getConnectionSecretRef(Long connectionId) {
        IqdConnection conn = connectionRepository.findById(connectionId)
                .orElseThrow(() -> new BusinessException(
                        ResultCode.NOT_FOUND, "问数连接不存在: " + connectionId));
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("connection_id", conn.getId());
        m.put("secret_ref", conn.getSecretRef());
        return m;
    }

    /**
     * 终态判定：build/index 进入 success/failed 即视为完成（可打时间戳）。
     */
    private static boolean isTerminalStatus(String status) {
        return "success".equals(status) || "failed".equals(status);
    }

    // ================================================================ 内部

    private void ensureConnection(Long connectionId) {
        if (!connectionRepository.existsById(connectionId)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "问数连接不存在: " + connectionId);
        }
    }

    /**
     * 取主连接：优先 {@code name='default'}（§14.5.1 A —— 主连接显式标识），
     * 否则取 id 最小的 {@code enabled=1}（确定性回退），都没有则任意第一条（兜底）。
     *
     * <p><b>权威真值源（单一选主口径，§14.5.1 B/D）</b>：本方法是全后端「主连接」判定的
     * 唯一权威实现 —— {@code GET /config}（{@link #getConnection()}）与内部面
     * {@code IqdInternalController.getConnections()} 的 {@code is_primary} 计算字段
     * **均由此处派生**，确保两侧落点恒等、无漂移。
     *
     * <p>可见性由 {@code private} 提升为 {@code public}，**仅为内部面跨类复用**
     * （{@code IqdInternalController} 计算 {@code is_primary}），**判定行为一字未改**。
     */
    public Optional<IqdConnection> findPrimaryConnection() {
        Optional<IqdConnection> byDefault = connectionRepository.findByName(PRIMARY_CONNECTION_NAME);
        if (byDefault.isPresent()) {
            return byDefault;
        }
        List<IqdConnection> enabled = connectionRepository.findByEnabledOrderByIdAsc(1);
        if (!enabled.isEmpty()) {
            return Optional.of(enabled.get(0));
        }
        List<IqdConnection> all = connectionRepository.findAll();
        return all.stream().findFirst();
    }

    private IqdConnectionVO toVO(IqdConnection entity) {
        IqdConnectionVO vo = new IqdConnectionVO();
        vo.setId(entity.getId());
        vo.setName(entity.getName());
        vo.setBaseUrl(entity.getBaseUrl());
        vo.setAuthType(entity.getAuthType());
        vo.setSecretRef(SECRET_PLACEHOLDER);
        vo.setProjectId(entity.getProjectId());
        vo.setDefaultConnector(entity.getDefaultConnector());
        vo.setTimeoutSeconds(entity.getTimeoutSeconds());
        vo.setLanguage(entity.getLanguage());
        vo.setStatus(entity.getStatus());
        vo.setLastHealthAt(entity.getLastHealthAt());
        vo.setLastHealthMsg(entity.getLastHealthMsg());
        vo.setEnabled(entity.getEnabled() != null && entity.getEnabled() == 1);
        vo.setMdlWritebackEnabled(entity.getMdlWritebackEnabled() != null
                && entity.getMdlWritebackEnabled());
        vo.setMcpStatus(entity.getMcpStatus());
        vo.setMcpPort(entity.getMcpPort());
        return vo;
    }

    private IqdCatalogItemVO toCatalogVO(IqdCatalogItem entity) {
        IqdCatalogItemVO vo = new IqdCatalogItemVO();
        vo.setId(entity.getId());
        vo.setConnectionId(entity.getConnectionId());
        vo.setKind(entity.getKind());
        vo.setParentKey(entity.getParentKey());
        vo.setItemKey(entity.getItemKey());
        vo.setDisplayName(entity.getDisplayName());
        vo.setDataType(entity.getDataType());
        vo.setIsPrimaryKey(entity.getIsPrimaryKey() != null && entity.getIsPrimaryKey() == 1);
        vo.setIsTimeDimension(entity.getIsTimeDimension() != null && entity.getIsTimeDimension() == 1);
        vo.setIsEmail(entity.getIsEmail() != null && entity.getIsEmail() == 1);
        vo.setDescription(entity.getDescription());
        vo.setExpression(entity.getExpression());
        vo.setModelRef(entity.getModelRef());
        vo.setSource(entity.getSource());
        vo.setInScope(entity.getInScope() != null && entity.getInScope() == 1);
        vo.setSensitiveLevel(entity.getSensitiveLevel());
        vo.setMaskRule(entity.getMaskRule());
        vo.setEditable(entity.getEditable() != null && entity.getEditable() == 1);
        return vo;
    }

    private IqdScopePolicyVO toScopePolicyVO(IqdScopePolicy entity) {
        IqdScopePolicyVO vo = new IqdScopePolicyVO();
        vo.setId(entity.getId());
        vo.setConnectionId(entity.getConnectionId());
        vo.setSubjectType(entity.getSubjectType());
        vo.setSubjectId(entity.getSubjectId());
        vo.setItemKey(entity.getItemKey());
        vo.setAllow(entity.getAllow() != null && entity.getAllow() == 1);
        vo.setEffective(entity.getEffective() != null && entity.getEffective() == 1);
        vo.setRemark(entity.getRemark());
        return vo;
    }

    private IqdAclVO toAclVO(IqdTableAcl entity) {
        IqdAclVO vo = new IqdAclVO();
        vo.setId(entity.getId());
        vo.setConnectionId(entity.getConnectionId());
        vo.setSubjectType(entity.getSubjectType());
        vo.setSubjectId(entity.getSubjectId());
        vo.setItemKey(entity.getItemKey());
        vo.setAction(entity.getAction());
        vo.setRowScope(entity.getRowScope());
        return vo;
    }

    private IqdMaskRuleVO toMaskRuleVO(IqdMaskRule entity) {
        IqdMaskRuleVO vo = new IqdMaskRuleVO();
        vo.setId(entity.getId());
        vo.setName(entity.getName());
        vo.setMatchType(entity.getMatchType());
        vo.setPattern(entity.getPattern());
        vo.setRule(entity.getRule());
        vo.setReplacement(entity.getReplacement());
        vo.setPriority(entity.getPriority());
        vo.setEnabled(entity.getEnabled() != null && entity.getEnabled() == 1);
        return vo;
    }

    private IqdScopeDimensionVO toDimensionVO(IqdRowScopeDimension entity) {
        IqdScopeDimensionVO vo = new IqdScopeDimensionVO();
        vo.setId(entity.getId());
        vo.setDimensionCode(entity.getDimensionCode());
        vo.setDimensionName(entity.getDimensionName());
        vo.setPredicateType(entity.getPredicateType());
        vo.setColumnName(entity.getColumnName());
        vo.setHeaderName(entity.getHeaderName());
        vo.setParamWhitelist(entity.getParamWhitelist());
        vo.setDictTable(entity.getDictTable());
        vo.setAutoMode(entity.getAutoMode() != null && entity.getAutoMode() == 1);
        vo.setEnabled(entity.getEnabled() != null && entity.getEnabled() == 1);
        vo.setSort(entity.getSort());
        return vo;
    }

    private List<String> parseWhitelist(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            List<String> out = objectMapper.readValue(json, new TypeReference<>() {});
            return out == null ? List.of() : out;
        } catch (Exception exc) {
            return List.of();
        }
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> asList(Object value) {
        if (value instanceof List<?> list) {
            return list.stream()
                    .filter(Map.class::isInstance)
                    .map(m -> (Map<String, Object>) m)
                    .collect(Collectors.toList());
        }
        return List.of();
    }

    private String jsonOrNull(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof String s) {
            return s;
        }
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exc) {
            log.warn("JSON serialize failed for field", exc);
            return null;
        }
    }

    private static Integer bool01(Object value) {
        if (value == null) {
            return 0;
        }
        if (value instanceof Boolean b) {
            return b ? 1 : 0;
        }
        if (value instanceof Number n) {
            return n.intValue() == 0 ? 0 : 1;
        }
        String s = String.valueOf(value);
        return "true".equalsIgnoreCase(s) || "1".equals(s) ? 1 : 0;
    }

    private static String defaultString(String value, String def) {
        return value == null || value.isBlank() ? def : value;
    }

    private static String str(Object value) {
        if (value == null) {
            return null;
        }
        return value instanceof String s ? s : String.valueOf(value);
    }

    /**
     * 归一脱敏等级（T04b）：`trim` + 小写后只接受 `none` / `low` / `high`（与列注释
     * `V71:89 sensitive_level VARCHAR(8) NOT NULL DEFAULT 'none'` 一致）。
     *
     * <p>返回 `null` 表示**非法**（含 `null` / 空白 / 其它取值），调用方据此抛 `42200`。
     * 严格枚举校验的理由：该值会参与 masking.py 规则链的第 2 层判定，放行脏值会让
     * 脱敏静默失效（既不脱敏也不报错）。
     */
    static String normalizeSensitiveLevel(Object raw) {
        if (raw == null) {
            return null;
        }
        String value = String.valueOf(raw).trim().toLowerCase(Locale.ROOT);
        return switch (value) {
            case "none", "low", "high" -> value;
            default -> null;
        };
    }

    private static Long toLong(Object value) {
        if (value == null || value instanceof Boolean) {
            return null;
        }
        try {
            if (value instanceof Number n) {
                return n.longValue();
            }
            return Long.parseLong(String.valueOf(value).trim());
        } catch (NumberFormatException exc) {
            return null;
        }
    }

    private static Integer toInt(Object value) {
        Long l = toLong(value);
        return l == null ? null : l.intValue();
    }

    // ================================================================ VO 转换（W3/W4）

    private IqdAskLogVO toAskLogVO(IqdAskLog entity) {
        IqdAskLogVO vo = new IqdAskLogVO();
        vo.setId(entity.getId());
        vo.setTraceId(entity.getTraceId());
        vo.setSessionId(entity.getSessionId());
        vo.setThreadId(entity.getThreadId());
        vo.setQueryId(entity.getQueryId());
        vo.setUserId(entity.getUserId());
        vo.setEmployeeId(entity.getEmployeeId());
        vo.setRoleCodes(entity.getRoleCodes());
        vo.setQuestion(entity.getQuestion());
        vo.setResolvedScope(entity.getResolvedScope());
        vo.setStatus(entity.getStatus());
        vo.setWrenStatusTrail(entity.getWrenStatusTrail());
        vo.setSqlText(entity.getSqlText());
        vo.setSqlDialect(entity.getSqlDialect());
        vo.setSummary(entity.getSummary());
        vo.setCitations(entity.getCitations());
        vo.setPlanSteps(entity.getPlanSteps());
        vo.setRowCount(entity.getRowCount());
        vo.setMaskedColumns(entity.getMaskedColumns());
        vo.setLatencyMs(entity.getLatencyMs());
        vo.setErrorCode(entity.getErrorCode());
        vo.setErrorMessage(entity.getErrorMessage());
        vo.setViewMode(entity.getViewMode());
        vo.setSimulatedRoleCode(entity.getSimulatedRoleCode());
        vo.setCreatedAt(entity.getCreatedAt());
        return vo;
    }

    private IqdSqlPairVO toSqlPairVO(IqdSqlPair entity) {
        IqdSqlPairVO vo = new IqdSqlPairVO();
        vo.setId(entity.getId());
        vo.setConnectionId(entity.getConnectionId());
        vo.setQuestion(entity.getQuestion());
        vo.setSourceDialect(entity.getSourceDialect());
        vo.setNativeSql(entity.getNativeSql());
        vo.setWrenSql(entity.getWrenSql());
        vo.setRemark(entity.getRemark());
        vo.setEnabled(entity.getEnabled() != null && entity.getEnabled() == 1);
        vo.setWrenRefId(entity.getWrenRefId());
        vo.setSyncStatus(entity.getSyncStatus());
        vo.setSyncedAt(entity.getSyncedAt());
        vo.setCreatedBy(entity.getCreatedBy());
        vo.setCreatedAt(entity.getCreatedAt());
        vo.setUpdatedAt(entity.getUpdatedAt());
        return vo;
    }

    private IqdKnowledgeVO toKnowledgeVO(IqdKnowledge entity) {
        IqdKnowledgeVO vo = new IqdKnowledgeVO();
        vo.setId(entity.getId());
        vo.setConnectionId(entity.getConnectionId());
        vo.setKind(entity.getKind());
        vo.setTitle(entity.getTitle());
        vo.setContent(entity.getContent());
        vo.setRelatedItemKeys(entity.getRelatedItemKeys());
        vo.setSource(entity.getSource());
        vo.setKbTermId(entity.getKbTermId());
        vo.setEnabled(entity.getEnabled() != null && entity.getEnabled() == 1);
        vo.setWrenRefId(entity.getWrenRefId());
        vo.setSyncStatus(entity.getSyncStatus());
        vo.setSyncedAt(entity.getSyncedAt());
        vo.setCreatedAt(entity.getCreatedAt());
        vo.setUpdatedAt(entity.getUpdatedAt());
        return vo;
    }

    private IqdSyncJobVO toSyncJobVO(IqdSyncJob entity) {
        IqdSyncJobVO vo = new IqdSyncJobVO();
        vo.setId(entity.getId());
        vo.setConnectionId(entity.getConnectionId());
        vo.setBuildStatus(entity.getBuildStatus());
        vo.setBuildMdlHash(entity.getBuildMdlHash());
        vo.setIndexStatus(entity.getIndexStatus());
        vo.setBuildAt(entity.getBuildAt());
        vo.setIndexAt(entity.getIndexAt());
        vo.setSyncedSqlPairCount(entity.getSyncedSqlPairCount());
        vo.setSyncedKnowledgeCount(entity.getSyncedKnowledgeCount());
        vo.setBuildError(entity.getBuildError());
        vo.setIndexError(entity.getIndexError());
        vo.setAction(entity.getAction());
        vo.setUpdatedAt(entity.getUpdatedAt());
        return vo;
    }
}
