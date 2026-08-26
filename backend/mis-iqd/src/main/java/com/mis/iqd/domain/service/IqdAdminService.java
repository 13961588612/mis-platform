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
import com.mis.iqd.domain.entity.IqdAskLog;
import com.mis.iqd.domain.entity.IqdCatalogItem;
import com.mis.iqd.domain.entity.IqdConnection;
import com.mis.iqd.domain.entity.IqdKnowledge;
import com.mis.iqd.domain.entity.IqdMaskRule;
import com.mis.iqd.domain.entity.IqdRowScopeDimension;
import com.mis.iqd.domain.entity.IqdScopePolicy;
import com.mis.iqd.domain.entity.IqdSqlPair;
import com.mis.iqd.domain.entity.IqdTableAcl;
import com.mis.iqd.domain.repository.IqdAskLogRepository;
import com.mis.iqd.domain.repository.IqdCatalogItemRepository;
import com.mis.iqd.domain.repository.IqdConnectionRepository;
import com.mis.iqd.domain.repository.IqdKnowledgeRepository;
import com.mis.iqd.domain.repository.IqdMaskRuleRepository;
import com.mis.iqd.domain.repository.IqdRowScopeDimensionRepository;
import com.mis.iqd.domain.repository.IqdScopePolicyRepository;
import com.mis.iqd.domain.repository.IqdSqlPairRepository;
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

    private final IqdConnectionRepository connectionRepository;
    private final IqdAskLogRepository askLogRepository;
    private final IqdCatalogItemRepository catalogItemRepository;
    private final IqdScopePolicyRepository scopePolicyRepository;
    private final IqdTableAclRepository tableAclRepository;
    private final IqdMaskRuleRepository maskRuleRepository;
    private final IqdRowScopeDimensionRepository dimensionRepository;
    private final IqdSqlPairRepository sqlPairRepository;
    private final IqdKnowledgeRepository knowledgeRepository;
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
        // 保存后置为 inactive，待测试连通性
        entity.setStatus("inactive");
        entity.setUpdatedAt(Instant.now());

        connectionRepository.save(entity);
        changeEventPublisher.publish("iqd.config.changed", "connection=" + entity.getId());
        log.info("IQD connection saved id={} name={} isNew={}", entity.getId(), entity.getName(), isNew);
        return toVO(entity);
    }

    /**
     * 连通性自检：GET {baseUrl}/health（短超时）。
     *
     * @return 自检结果（status/latency_ms/last_health_at）
     */
    @Transactional
    public Map<String, Object> testConnection() {
        Optional<IqdConnection> existing = findPrimaryConnection();
        if (existing.isEmpty()) {
            throw new BusinessException(ResultCode.NOT_FOUND, "尚未配置问数连接");
        }
        IqdConnection entity = existing.get();
        String baseUrl = entity.getBaseUrl();
        if (baseUrl == null || baseUrl.isBlank()) {
            entity.setStatus("inactive");
            entity.setLastHealthAt(Instant.now());
            entity.setLastHealthMsg("未配置 WrenAI 地址，请先保存连接配置");
            entity.setUpdatedAt(Instant.now());
            connectionRepository.save(entity);
            return Map.of("status", "inactive", "message", entity.getLastHealthMsg());
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

    // ================================================================ 内部

    private void ensureConnection(Long connectionId) {
        if (!connectionRepository.existsById(connectionId)) {
            throw new BusinessException(ResultCode.NOT_FOUND, "问数连接不存在: " + connectionId);
        }
    }

    /**
     * 取主连接：优先 name='default'，否则取第一条 enabled=1；都没有则任意第一条。
     */
    private Optional<IqdConnection> findPrimaryConnection() {
        Optional<IqdConnection> byDefault = connectionRepository.findByName("default");
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
        vo.setSource(entity.getSource());
        vo.setInScope(entity.getInScope() != null && entity.getInScope() == 1);
        vo.setSensitiveLevel(entity.getSensitiveLevel());
        vo.setMaskRule(entity.getMaskRule());
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
}
