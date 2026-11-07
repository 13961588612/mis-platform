package com.mis.aireport.domain.service;

import com.mis.aireport.client.IamUserClient;
import com.mis.aireport.domain.entity.AiParamSource;
import com.mis.aireport.domain.entity.AiReportAcl;
import com.mis.aireport.domain.entity.AiReportCategory;
import com.mis.aireport.domain.entity.AiReportDef;
import com.mis.aireport.domain.entity.AiReportResultCache;
import com.mis.aireport.domain.param.ParamOption;
import com.mis.aireport.domain.param.ParamResolveResult;
import com.mis.aireport.domain.param.ParamSourceCodes;
import com.mis.aireport.domain.param.ParamSourceHandler;
import com.mis.aireport.domain.param.ParamSourceHandlerRegistry;
import com.mis.aireport.domain.repository.AiParamSourceRepository;
import com.mis.aireport.domain.repository.AiReportAclRepository;
import com.mis.aireport.domain.repository.AiReportCategoryRepository;
import com.mis.aireport.domain.repository.AiReportDefRepository;
import com.mis.aireport.domain.repository.AiReportResultCacheRepository;
import com.mis.aireport.domain.repository.AiReportStoreDimRepository;
import com.mis.aireport.support.IdGenerator;
import com.mis.aireport.support.ReportCacheTokenService;
import com.mis.aireport.support.ReportParamsHasher;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

@Service
public class AiReportRuntimeService {

    /** 业务码：无权限或无可选参数 → 前端不插卡。 */
    public static final int CODE_NO_PARAM_ACCESS = 40321;

    private static final Pattern PROMPT_PLACEHOLDER = Pattern.compile("\\{\\{\\s*([a-zA-Z0-9_]+)\\s*\\}\\}");

    private final AiReportCategoryRepository categoryRepository;
    private final AiReportDefRepository reportDefRepository;
    private final AiReportAclRepository aclRepository;
    private final AiParamSourceRepository paramSourceRepository;
    private final AiReportStoreDimRepository storeDimRepository;
    private final AiReportResultCacheRepository resultCacheRepository;
    private final ParamSourceHandlerRegistry handlerRegistry;
    private final IamUserClient iamUserClient;
    private final ReportParamsHasher paramsHasher;
    private final ReportCacheTokenService cacheTokenService;

    public AiReportRuntimeService(
            AiReportCategoryRepository categoryRepository,
            AiReportDefRepository reportDefRepository,
            AiReportAclRepository aclRepository,
            AiParamSourceRepository paramSourceRepository,
            AiReportStoreDimRepository storeDimRepository,
            AiReportResultCacheRepository resultCacheRepository,
            ParamSourceHandlerRegistry handlerRegistry,
            IamUserClient iamUserClient,
            ReportParamsHasher paramsHasher,
            ReportCacheTokenService cacheTokenService) {
        this.categoryRepository = categoryRepository;
        this.reportDefRepository = reportDefRepository;
        this.aclRepository = aclRepository;
        this.paramSourceRepository = paramSourceRepository;
        this.storeDimRepository = storeDimRepository;
        this.resultCacheRepository = resultCacheRepository;
        this.handlerRegistry = handlerRegistry;
        this.iamUserClient = iamUserClient;
        this.paramsHasher = paramsHasher;
        this.cacheTokenService = cacheTokenService;
    }

    @Transactional(readOnly = true)
    public List<Map<String, Object>> catalog() {
        Long userId = requireUserId();
        Set<String> allowedCodes = allowedReportCodes(userId);
        if (allowedCodes.isEmpty()) {
            return List.of();
        }

        Map<Long, AiReportCategory> cats = categoryRepository.findAll().stream()
                .collect(Collectors.toMap(AiReportCategory::getId, c -> c, (a, b) -> a, LinkedHashMap::new));

        List<AiReportDef> defs = reportDefRepository.findAllByOrderBySortOrderAscIdAsc().stream()
                .filter(d -> d.getEnabled() != null && d.getEnabled() == 1)
                .filter(d -> allowedCodes.contains(d.getReportCode()))
                .toList();

        Map<Long, List<AiReportDef>> byGroup = new LinkedHashMap<>();
        for (AiReportDef def : defs) {
            Long groupId = findGroupAncestorId(def.getCategoryId(), cats);
            if (groupId == null) {
                continue;
            }
            byGroup.computeIfAbsent(groupId, k -> new ArrayList<>()).add(def);
        }

        List<Long> groupIds = new ArrayList<>(byGroup.keySet());
        groupIds.sort(Comparator
                .comparingInt((Long id) -> {
                    AiReportCategory g = cats.get(id);
                    return g != null && g.getSortOrder() != null ? g.getSortOrder() : 0;
                })
                .thenComparingLong(id -> id));

        List<Map<String, Object>> out = new ArrayList<>();
        for (Long groupId : groupIds) {
            AiReportCategory group = cats.get(groupId);
            if (group == null || group.getEnabled() == null || group.getEnabled() != 1) {
                continue;
            }
            if (group.getIsGroup() == null || group.getIsGroup() != 1) {
                continue;
            }
            List<AiReportDef> groupDefs = new ArrayList<>(byGroup.getOrDefault(groupId, List.of()));
            groupDefs.sort(Comparator
                    .comparingInt((AiReportDef d) -> d.getSortOrder() != null ? d.getSortOrder() : 0)
                    .thenComparingLong(AiReportDef::getId));

            Map<String, Object> node = new LinkedHashMap<>();
            node.put("group_id", group.getId());
            node.put("group_code", group.getCode());
            node.put("group_name", group.getName());
            node.put("sort_order", group.getSortOrder() != null ? group.getSortOrder() : 0);
            List<Map<String, Object>> reports = new ArrayList<>();
            for (AiReportDef def : groupDefs) {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("report_code", def.getReportCode());
                r.put("title", def.getTitle());
                r.put("description", def.getDescription());
                r.put("use_ai_workflow", def.getUseAiWorkflow() != null && def.getUseAiWorkflow() == 1);
                r.put("workflow_code", def.getWorkflowCode());
                r.put("workflow_platform_code", def.getWorkflowPlatformCode());
                r.put("sort_order", def.getSortOrder() != null ? def.getSortOrder() : 0);
                reports.add(r);
            }
            node.put("reports", reports);
            out.add(node);
        }
        return out;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> prepareCard(String reportCode) {
        Long userId = requireUserId();
        if (!StringUtils.hasText(reportCode)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "reportCode 不能为空");
        }
        AiReportDef def = reportDefRepository.findByReportCode(reportCode.trim())
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "报告不存在"));
        if (def.getEnabled() == null || def.getEnabled() != 1) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "报告未启用");
        }
        if (!allowedReportCodes(userId).contains(def.getReportCode())) {
            throw new BusinessException(CODE_NO_PARAM_ACCESS, "无权限访问该报告");
        }

        List<Map<String, Object>> slots = def.getSlotsJson() == null ? List.of() : def.getSlotsJson();
        List<Map<String, Object>> resolvedSlots = new ArrayList<>();
        for (Map<String, Object> slot : slots) {
            String sourceCode = ParamSourceCodes.canonical(
                    String.valueOf(slot.getOrDefault("source_code", "")));
            boolean required = slot.get("required") == null
                    || Boolean.TRUE.equals(slot.get("required"))
                    || "true".equalsIgnoreCase(String.valueOf(slot.get("required")));
            AiParamSource source = paramSourceRepository.findBySourceCode(sourceCode)
                    .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "未知参数来源: " + sourceCode));
            if (source.getEnabled() == null || source.getEnabled() != 1) {
                throw new BusinessException(CODE_NO_PARAM_ACCESS, "参数来源未启用: " + sourceCode);
            }
            ParamSourceHandler handler = handlerRegistry.require(source.getHandlerBean());
            ParamResolveResult resolved = handler.resolve(userId, source);
            if (required && (resolved.options() == null || resolved.options().isEmpty())) {
                throw new BusinessException(CODE_NO_PARAM_ACCESS, "无可选参数或无权限: " + source.getName());
            }
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("source_code", resolved.sourceCode());
            item.put("value_type", resolved.valueType());
            item.put("wire_key", resolved.wireKey());
            Object labelOverride = slot.get("label_override");
            item.put("label", labelOverride != null && StringUtils.hasText(String.valueOf(labelOverride))
                    ? String.valueOf(labelOverride).trim()
                    : resolved.label());
            item.put("required", required);
            item.put("default_value", resolved.defaultValue());
            item.put("options", resolved.options().stream().map(this::optionToMap).toList());
            resolvedSlots.add(item);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("report_code", def.getReportCode());
        out.put("title", def.getTitle());
        out.put("description", def.getDescription());
        out.put("use_ai_workflow", def.getUseAiWorkflow() != null && def.getUseAiWorkflow() == 1);
        out.put("workflow_code", def.getWorkflowCode());
        out.put("workflow_platform_code", def.getWorkflowPlatformCode());
        out.put("slots", resolvedSlots);
        return out;
    }

    @Transactional(readOnly = true)
    public Map<String, Object> execute(Map<String, Object> body) {
        Long userId = requireUserId();
        String reportCode = String.valueOf(body.getOrDefault("reportCode", body.getOrDefault("report_code", ""))).trim();
        if (!StringUtils.hasText(reportCode)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "reportCode 不能为空");
        }
        AiReportDef def = reportDefRepository.findByReportCode(reportCode)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "报告不存在"));
        if (!allowedReportCodes(userId).contains(def.getReportCode())) {
            throw new BusinessException(CODE_NO_PARAM_ACCESS, "无权限执行该报告");
        }

        boolean regenerate = Boolean.TRUE.equals(body.get("regenerate"))
                || "true".equalsIgnoreCase(String.valueOf(body.getOrDefault("regenerate", "")));

        @SuppressWarnings("unchecked")
        Map<String, Object> params = body.get("params") instanceof Map<?, ?> m
                ? (Map<String, Object>) m
                : Map.of();

        Map<String, Object> normalized = normalizeAndValidateParams(userId, def, params);
        String paramsHash = paramsHasher.hash(normalized);
        boolean useWf = def.getUseAiWorkflow() != null && def.getUseAiWorkflow() == 1;

        if (!regenerate) {
            AiReportResultCache cached = resultCacheRepository
                    .findByReportCodeAndParamsHash(def.getReportCode(), paramsHash)
                    .orElse(null);
            if (cached != null
                    && cached.getExpiresAt() != null
                    && cached.getExpiresAt().isAfter(Instant.now())
                    && StringUtils.hasText(cached.getContentMd())) {
                Map<String, Object> hit = new LinkedHashMap<>();
                hit.put("mode", "cached");
                hit.put("report_code", def.getReportCode());
                hit.put("title", def.getTitle());
                hit.put("params", normalized);
                hit.put("content_md", cached.getContentMd());
                hit.put("read_from_cache", true);
                hit.put("save_to_cache", false);
                hit.put("cached_at", cached.getCachedAt() != null ? cached.getCachedAt().toString() : null);
                hit.put("expires_at", cached.getExpiresAt().toString());
                hit.put("status", "ok");
                return hit;
            }
        }

        if (useWf) {
            String agentId = def.getTargetAgentId() != null ? def.getTargetAgentId().trim() : "";
            if (!StringUtils.hasText(agentId)) {
                throw new BusinessException(ResultCode.VALIDATION_ERROR,
                        "报告未配置目标智能体 target_agent_id");
            }
            String skillId = StringUtils.hasText(def.getTargetSkillId())
                    ? def.getTargetSkillId().trim() : null;
            String message = renderPrompt(def, normalized);
            String token = cacheTokenService.issue(def.getReportCode(), paramsHash, userId, true);

            Map<String, Object> metadata = new LinkedHashMap<>();
            metadata.put("kind", "ai_report_run");
            metadata.put("report_code", def.getReportCode());
            metadata.put("hard_dispatch", true);
            if (skillId != null) {
                metadata.put("target_skill_id", skillId);
            }

            Map<String, Object> result = new LinkedHashMap<>();
            result.put("mode", "agent_run");
            result.put("report_code", def.getReportCode());
            result.put("title", def.getTitle());
            result.put("params", normalized);
            result.put("params_hash", paramsHash);
            result.put("agent_id", agentId);
            result.put("skill_id", skillId);
            result.put("message", message);
            result.put("read_from_cache", false);
            result.put("save_to_cache", true);
            result.put("cache_write_token", token);
            result.put("use_ai_workflow", true);
            result.put("workflow_platform_code", def.getWorkflowPlatformCode());
            result.put("metadata", metadata);
            result.put("status", "ok");
            return result;
        }

        // 非 AI 工作流：保留模拟表，便于联调
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("mode", "table");
        result.put("report_code", def.getReportCode());
        result.put("title", def.getTitle());
        result.put("params", normalized);
        result.put("use_ai_workflow", false);
        result.put("read_from_cache", false);
        result.put("save_to_cache", false);
        result.put("status", "ok");
        result.put("message", "模拟执行成功（未启用 AI 工作流）");
        result.put("columns", List.of("维度", "指标", "数值", "单位"));
        result.put("rows", buildMockRows(def.getReportCode(), normalized));
        return result;
    }

    @Transactional
    public Map<String, Object> saveResult(Map<String, Object> body) {
        Long userId = requireUserId();
        String reportCode = String.valueOf(body.getOrDefault("reportCode", body.getOrDefault("report_code", ""))).trim();
        String token = String.valueOf(body.getOrDefault("cacheWriteToken",
                body.getOrDefault("cache_write_token", ""))).trim();
        String contentMd = String.valueOf(body.getOrDefault("contentMd",
                body.getOrDefault("content_md", ""))).trim();
        if (!StringUtils.hasText(reportCode)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "reportCode 不能为空");
        }
        if (!StringUtils.hasText(contentMd)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "content_md 不能为空");
        }
        AiReportDef def = reportDefRepository.findByReportCode(reportCode)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "报告不存在"));
        if (!allowedReportCodes(userId).contains(def.getReportCode())) {
            throw new BusinessException(CODE_NO_PARAM_ACCESS, "无权限写入该报告缓存");
        }

        @SuppressWarnings("unchecked")
        Map<String, Object> params = body.get("params") instanceof Map<?, ?> m
                ? (Map<String, Object>) m
                : Map.of();
        Map<String, Object> normalized = normalizeAndValidateParams(userId, def, params);
        String paramsHash = paramsHasher.hash(normalized);
        cacheTokenService.parseAndVerify(token, def.getReportCode(), paramsHash, userId);

        Instant now = Instant.now();
        int ttlHours = def.getCacheTtlHours() != null && def.getCacheTtlHours() > 0
                ? def.getCacheTtlHours() : 24;
        AiReportResultCache row = resultCacheRepository
                .findByReportCodeAndParamsHash(def.getReportCode(), paramsHash)
                .orElseGet(AiReportResultCache::new);
        if (row.getId() == null) {
            row.setId(IdGenerator.nextId());
            row.setReportCode(def.getReportCode());
            row.setParamsHash(paramsHash);
            row.setCreatedBy(userId);
            row.setCachedAt(now);
        }
        row.setParamsJson(new LinkedHashMap<>(normalized));
        row.setContentMd(contentMd);
        row.setAgentId(def.getTargetAgentId());
        row.setSkillId(def.getTargetSkillId());
        row.setExpiresAt(now.plus(ttlHours, ChronoUnit.HOURS));
        row.setUpdatedAt(now);
        resultCacheRepository.save(row);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("report_code", def.getReportCode());
        out.put("params_hash", paramsHash);
        out.put("cached_at", row.getCachedAt().toString());
        out.put("expires_at", row.getExpiresAt().toString());
        out.put("status", "ok");
        return out;
    }

    private Map<String, Object> normalizeAndValidateParams(
            Long userId, AiReportDef def, Map<String, Object> params) {
        List<Map<String, Object>> slots = def.getSlotsJson() == null ? List.of() : def.getSlotsJson();
        Map<String, Object> normalized = new LinkedHashMap<>();
        for (Map<String, Object> slot : slots) {
            String sourceCode = ParamSourceCodes.canonical(
                    String.valueOf(slot.getOrDefault("source_code", "")));
            boolean required = slot.get("required") == null
                    || Boolean.TRUE.equals(slot.get("required"))
                    || "true".equalsIgnoreCase(String.valueOf(slot.get("required")));
            AiParamSource source = paramSourceRepository.findBySourceCode(sourceCode)
                    .orElseThrow(() -> new BusinessException(ResultCode.VALIDATION_ERROR, "未知参数来源: " + sourceCode));
            String wireKey = source.getWireKey();
            Object raw = params.get(wireKey);
            if (raw == null) {
                raw = params.get(sourceCode);
            }
            String value = raw == null ? null : String.valueOf(raw).trim();
            if (!StringUtils.hasText(value)) {
                if (required) {
                    throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少参数: " + wireKey);
                }
                continue;
            }
            ParamSourceHandler handler = handlerRegistry.require(source.getHandlerBean());
            if (!handler.accepts(userId, source, value)) {
                throw new BusinessException(CODE_NO_PARAM_ACCESS, "参数越权或无效: " + wireKey);
            }
            normalized.put(wireKey, value);
            if ("store".equals(source.getValueType())) {
                storeDimRepository.findByStoreCodeAndEnabled(value, 1).ifPresent(s -> {
                    normalized.put("storeId", s.getStoreCode());
                    normalized.put("storeName", s.getStoreName());
                });
            }
        }
        return normalized;
    }

    private String renderPrompt(AiReportDef def, Map<String, Object> params) {
        Map<String, Object> ctx = new LinkedHashMap<>(params);
        ctx.put("title", def.getTitle());
        ctx.put("report_code", def.getReportCode());
        String template = def.getPromptTemplate();
        if (!StringUtils.hasText(template)) {
            StringBuilder sb = new StringBuilder();
            sb.append("请按「").append(def.getTitle()).append("」生成报告。\n");
            for (Map.Entry<String, Object> e : params.entrySet()) {
                sb.append(e.getKey()).append("：").append(e.getValue()).append('\n');
            }
            return sb.toString().trim();
        }
        Matcher m = PROMPT_PLACEHOLDER.matcher(template);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String key = m.group(1);
            Object val = ctx.get(key);
            m.appendReplacement(sb, Matcher.quoteReplacement(val == null ? "" : String.valueOf(val)));
        }
        m.appendTail(sb);
        return sb.toString().trim();
    }

    /** 按报告编号拼几行可读模拟数据，把入参回显进结果。 */
    private List<Map<String, Object>> buildMockRows(String reportCode, Map<String, Object> params) {
        String store = String.valueOf(params.getOrDefault("storeName",
                params.getOrDefault("storeId",
                        params.getOrDefault("spmStoreId", "—"))));
        String period = firstNonBlank(
                params.get("spmBizDate"),
                params.get("spmOrdWeek"),
                params.get("spmOrdMonth"),
                params.get("bizDate"),
                params.get("ordWeek"),
                params.get("ordMonth"),
                "—");
        List<Map<String, Object>> rows = new ArrayList<>();
        rows.add(mockRow(store + " / " + period, "销售额", "1,286,430.50", "元"));
        rows.add(mockRow(store + " / " + period, "客单数", "18,642", "笔"));
        rows.add(mockRow(store + " / " + period, "毛利率", "24.6", "%"));
        rows.add(mockRow(store + " / " + period, "来客数", "12,308", "人"));
        if ("RPT_WEEKLY".equals(reportCode)) {
            rows.add(mockRow(store + " / " + period, "周环比销售额", "+3.2", "%"));
        }
        return rows;
    }

    private static Map<String, Object> mockRow(String dim, String metric, String value, String unit) {
        Map<String, Object> row = new LinkedHashMap<>();
        row.put("维度", dim);
        row.put("指标", metric);
        row.put("数值", value);
        row.put("单位", unit);
        return row;
    }

    private static String firstNonBlank(Object... values) {
        for (Object v : values) {
            if (v == null) {
                continue;
            }
            String s = String.valueOf(v).trim();
            if (StringUtils.hasText(s) && !"null".equalsIgnoreCase(s)) {
                return s;
            }
        }
        return "—";
    }

    private Set<String> allowedReportCodes(Long userId) {
        List<Long> roleIds = iamUserClient.fetchRoleIds(userId);
        if (roleIds.isEmpty()) {
            return Set.of();
        }
        Set<String> roleIdStr = roleIds.stream().map(String::valueOf).collect(Collectors.toSet());
        Set<String> codes = new HashSet<>();
        for (AiReportAcl acl : aclRepository.findAll()) {
            if (!"ROLE".equalsIgnoreCase(acl.getSubjectType())) {
                continue;
            }
            if (roleIdStr.contains(acl.getSubjectId())) {
                codes.add(acl.getReportCode());
            }
        }
        return codes;
    }

    private Long findGroupAncestorId(Long categoryId, Map<Long, AiReportCategory> cats) {
        Long cursor = categoryId;
        Set<Long> guard = new HashSet<>();
        while (cursor != null && cursor > 0 && guard.add(cursor)) {
            AiReportCategory c = cats.get(cursor);
            if (c == null) {
                return null;
            }
            if (c.getIsGroup() != null && c.getIsGroup() == 1) {
                return c.getId();
            }
            cursor = c.getParentId();
        }
        return null;
    }

    private Map<String, Object> optionToMap(ParamOption opt) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("value", opt.value());
        m.put("label", opt.label());
        if (opt.extra() != null && !opt.extra().isEmpty()) {
            m.put("extra", opt.extra());
        }
        return m;
    }

    private Long requireUserId() {
        Long userId = SecurityContextHolder.getOptional()
                .map(u -> u.getUserId())
                .orElse(null);
        if (userId == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED, "未登录");
        }
        return userId;
    }
}
