package com.mis.aireport.domain.service;

import com.mis.aireport.client.IamUserClient;
import com.mis.aireport.domain.entity.AiParamSource;
import com.mis.aireport.domain.entity.AiReportAcl;
import com.mis.aireport.domain.entity.AiReportCategory;
import com.mis.aireport.domain.entity.AiReportDef;
import com.mis.aireport.domain.param.ParamOption;
import com.mis.aireport.domain.param.ParamResolveResult;
import com.mis.aireport.domain.param.ParamSourceHandler;
import com.mis.aireport.domain.param.ParamSourceHandlerRegistry;
import com.mis.aireport.domain.repository.AiParamSourceRepository;
import com.mis.aireport.domain.repository.AiReportAclRepository;
import com.mis.aireport.domain.repository.AiReportCategoryRepository;
import com.mis.aireport.domain.repository.AiReportDefRepository;
import com.mis.aireport.domain.repository.AiReportStoreDimRepository;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.security.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class AiReportRuntimeService {

    /** 业务码：无权限或无可选参数 → 前端不插卡。 */
    public static final int CODE_NO_PARAM_ACCESS = 40321;

    private final AiReportCategoryRepository categoryRepository;
    private final AiReportDefRepository reportDefRepository;
    private final AiReportAclRepository aclRepository;
    private final AiParamSourceRepository paramSourceRepository;
    private final AiReportStoreDimRepository storeDimRepository;
    private final ParamSourceHandlerRegistry handlerRegistry;
    private final IamUserClient iamUserClient;

    public AiReportRuntimeService(
            AiReportCategoryRepository categoryRepository,
            AiReportDefRepository reportDefRepository,
            AiReportAclRepository aclRepository,
            AiParamSourceRepository paramSourceRepository,
            AiReportStoreDimRepository storeDimRepository,
            ParamSourceHandlerRegistry handlerRegistry,
            IamUserClient iamUserClient) {
        this.categoryRepository = categoryRepository;
        this.reportDefRepository = reportDefRepository;
        this.aclRepository = aclRepository;
        this.paramSourceRepository = paramSourceRepository;
        this.storeDimRepository = storeDimRepository;
        this.handlerRegistry = handlerRegistry;
        this.iamUserClient = iamUserClient;
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

        List<Map<String, Object>> out = new ArrayList<>();
        for (Map.Entry<Long, List<AiReportDef>> e : byGroup.entrySet()) {
            AiReportCategory group = cats.get(e.getKey());
            if (group == null || group.getEnabled() == null || group.getEnabled() != 1) {
                continue;
            }
            if (group.getIsGroup() == null || group.getIsGroup() != 1) {
                continue;
            }
            Map<String, Object> node = new LinkedHashMap<>();
            node.put("group_id", group.getId());
            node.put("group_code", group.getCode());
            node.put("group_name", group.getName());
            List<Map<String, Object>> reports = new ArrayList<>();
            for (AiReportDef def : e.getValue()) {
                Map<String, Object> r = new LinkedHashMap<>();
                r.put("report_code", def.getReportCode());
                r.put("title", def.getTitle());
                r.put("description", def.getDescription());
                r.put("use_ai_workflow", def.getUseAiWorkflow() != null && def.getUseAiWorkflow() == 1);
                r.put("workflow_code", def.getWorkflowCode());
                r.put("workflow_platform_code", def.getWorkflowPlatformCode());
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
            String sourceCode = String.valueOf(slot.getOrDefault("source_code", "")).trim();
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

        @SuppressWarnings("unchecked")
        Map<String, Object> params = body.get("params") instanceof Map<?, ?> m
                ? (Map<String, Object>) m
                : Map.of();

        List<Map<String, Object>> slots = def.getSlotsJson() == null ? List.of() : def.getSlotsJson();
        Map<String, Object> normalized = new LinkedHashMap<>();
        for (Map<String, Object> slot : slots) {
            String sourceCode = String.valueOf(slot.getOrDefault("source_code", "")).trim();
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

        boolean useWf = def.getUseAiWorkflow() != null && def.getUseAiWorkflow() == 1;
        // 以 def 为准，忽略客户端篡改
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("report_code", def.getReportCode());
        result.put("title", def.getTitle());
        result.put("params", normalized);
        result.put("use_ai_workflow", useWf);
        result.put("workflow_code", useWf ? def.getWorkflowCode() : null);
        result.put("workflow_platform_code", useWf ? def.getWorkflowPlatformCode() : null);
        result.put("status", "stub");
        result.put("message", "S3 桩：参数已校验；真实取数引擎在后续阶段接入");
        result.put("rows", List.of());
        return result;
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
