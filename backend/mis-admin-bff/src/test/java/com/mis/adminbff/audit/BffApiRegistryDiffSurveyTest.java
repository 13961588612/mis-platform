package com.mis.adminbff.audit;

import com.mis.adminbff.client.AiPlatformClient;
import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.config.AiPlatformProperties;
import com.mis.adminbff.controller.AgentOpsChannelController;
import com.mis.adminbff.controller.AgentOpsController;
import com.mis.adminbff.controller.AgentOpsGrantController;
import com.mis.adminbff.controller.AiProxyController;
import com.mis.adminbff.controller.AppController;
import com.mis.adminbff.controller.AuthMeController;
import com.mis.adminbff.controller.DashboardController;
import com.mis.adminbff.controller.DeptController;
import com.mis.adminbff.controller.DictController;
import com.mis.adminbff.controller.EmployeeController;
import com.mis.adminbff.controller.InternalPermissionController;
import com.mis.adminbff.controller.KbController;
import com.mis.adminbff.controller.KbSynonymController;
import com.mis.adminbff.controller.McpPermissionController;
import com.mis.adminbff.controller.MenuController;
import com.mis.adminbff.controller.ModuleController;
import com.mis.adminbff.controller.OrgController;
import com.mis.adminbff.controller.RoleController;
import com.mis.adminbff.controller.UserController;
import com.mis.adminbff.security.SkillPermissionChecker;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.service.AiCapabilityTranslator;
import com.mis.adminbff.service.AiFeatureConfigService;
import com.mis.adminbff.service.DashboardAggregateService;
import com.mis.adminbff.service.DictFacadeService;
import com.mis.adminbff.service.KbFacadeService;
import com.mis.adminbff.service.KbSynonymFacadeService;
import com.mis.adminbff.service.MenuAggregateService;
import com.mis.adminbff.service.ModuleFacadeService;
import com.mis.adminbff.service.OrgFacadeService;
import com.mis.adminbff.service.RoleFacadeService;
import com.mis.adminbff.service.UserAggregateService;
import com.mis.adminbff.service.agentops.AgentOpsFacadeService;
import com.mis.adminbff.service.agentops.AgentOpsGrantService;
import com.mis.adminbff.service.agentops.McpPermissionService;
import com.mis.adminbff.service.agentops.WecomBotFacadeService;
import com.mis.adminbff.service.skill.DocWriteRegistry;
import com.mis.adminbff.service.skill.SkillExecutionEngine;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/**
 * SEC-02 全平台差集盘点工具（技术债 11.3 前置硬门槛，PRD SEC-02）。
 *
 * <p>用 Spring {@link RequestMappingHandlerMapping} 注册 mis-admin-bff 全部 19 个
 * Controller（含类级 {@code @RequestMapping} 前缀拼接），运行时导出全量
 * {@code /api/v1/**} 端点；与全仓迁移（V2~V35）写入 {@code sys_api} 的注册表 fixture
 * 做差集（method + path 归一化精确匹配）。产出：
 *
 * <ul>
 *   <li>KB 域差集必须<b>恰好等于</b>待登记的 28 个端点（READ-01~24 + WRITE-01~04）——
 *       多一个少一个都红灯（SEC-03/04 补登范围锁定）；</li>
 *   <li>非 KB 域未登记端点逐项输出到控制台并断言非空处置结论，供
 *       {@code docs/backend/mis-kb-security-sprint-diff-list-2026-08-12.md} 落盘引用
 *       （主理人 U4 裁决：非 KB 未登记端点不得静默放行，只盘点不改造）。</li>
 * </ul>
 *
 * <p>差集口径：<b>path 归一化</b>——注册表 path_pattern 沿用 V18/V30/V31 的
 * {@code {id:[0-9]+}} 写法，Spring 导出为 {@code {id}}，故把 {@code {var:regex}}
 * 归一化为 {@code {var}} 后逐字比较（设计 §5.2 静态扫描口径交叉验证）。
 *
 * <p>本测试<b>不做运行时 DB 查询</b>：注册表 fixture 从全仓迁移 grep 生成并随代码固化
 * （设计 §5.2「注册表侧 fixture」允许路径），若后续迁移新增登记行需同步追加 fixture。
 */
class BffApiRegistryDiffSurveyTest {

    /** 待登记 KB 端点（PRD §2.3 + 设计 §1.7）：{@code "METHOD PATH"} 归一化形式。 */
    private static final Set<String> EXPECTED_KB_28 = Set.of(
            // READ-01~24
            "GET /api/v1/kb/categories",
            "GET /api/v1/kb/libraries",
            "GET /api/v1/kb/libraries/{id}",
            "GET /api/v1/kb/libraries/{id}/detail",
            "GET /api/v1/kb/libraries/{id}/engine/settings",
            "GET /api/v1/kb/libraries/{libraryId}/documents",
            "GET /api/v1/kb/libraries/{libraryId}/documents/{id}",
            "GET /api/v1/kb/libraries/{libraryId}/acls",
            "GET /api/v1/kb/qa/sessions/mine",
            "GET /api/v1/kb/qa/sessions/{sessionId}",
            "GET /api/v1/kb/qa/sessions/{sessionId}/feedback",
            "GET /api/v1/kb/operations/qa/sessions",
            "GET /api/v1/kb/operations/qa/sessions/{sessionId}",
            "GET /api/v1/kb/operations/qa/sessions-all",
            "GET /api/v1/kb/operations/qa/feedback",
            "GET /api/v1/kb/operations/stats",
            "GET /api/v1/kb/operations/qa/export",
            "GET /api/v1/kb/operations/qa/tickets",
            "GET /api/v1/kb/operations/qa/tickets/{ticketId}",
            "GET /api/v1/kb/operations/qa/tickets/by-session/{sessionId}",
            "GET /api/v1/kb/subjects/search",
            "GET /api/v1/kb/engine/health",
            "GET /api/v1/kb/engine/capabilities",
            "GET /api/v1/kb/engine/models",
            // WRITE-01~04
            "DELETE /api/v1/kb/libraries/{id}",
            "POST /api/v1/kb/qa/feedback",
            "POST /api/v1/kb/operations/qa/tickets",
            "PATCH /api/v1/kb/operations/qa/tickets/{ticketId}"
    );

    /** AI 反向信任端点（Q3/U1：本期 V33 authOnly 登记，permission 为空即 authOnly）。 */
    private static final Set<String> EXPECTED_AI_AUTHONLY_2 = Set.of(
            "POST /api/v1/ai/skill/execute",
            "POST /api/v1/ai/skill/apply"
    );

    /**
     * V32 之前的 KB 已登记<b>去重后</b> 42 行基线（V17/V18/V24/V25/V26/V27/V30/V31）。
     * <p>PRD §2.2 记「45 行」是按迁移行数（V30 含 3 行与 V24/V25 重复、被幂等守卫跳过）；
     * 实际 sys_api 唯一 (method, path) 为 42 行——本集合同 V30 注释「实际净新增 14 行」口径。
     * V32 净新增 28 行后，KB 唯一端点 = 42 + 28 = 70，与 KbController/KbSynonymController 导出一致。</p>
     */
    private static final Set<String> KB_42_BASELINE = Set.of(
            "POST /api/v1/kb/hit-test",
            "GET /api/v1/kb/synonyms",
            "GET /api/v1/kb/synonyms/{id}",
            "POST /api/v1/kb/synonyms",
            "PUT /api/v1/kb/synonyms/{id}",
            "DELETE /api/v1/kb/synonyms/{id}",
            "GET /api/v1/kb/synonyms/config",
            "PUT /api/v1/kb/synonyms/config",
            "GET /api/v1/kb/synonyms/export",
            "POST /api/v1/kb/synonyms/import/precheck",
            "POST /api/v1/kb/synonyms/import/commit",
            "GET /api/v1/kb/synonyms/import/{batchId}/rejected",
            "GET /api/v1/kb/categories/manageable-ids",
            "PUT /api/v1/kb/categories/{id}/move",
            "POST /api/v1/kb/categories/{id}/admins",
            "DELETE /api/v1/kb/category-admins/{adminId}",
            "GET /api/v1/kb/categories/{id}/admins",
            "GET /api/v1/kb/libraries/{id}/engine-ref",
            "GET /api/v1/kb/engine/reconcile",
            "POST /api/v1/kb/engine/reconcile",
            "GET /api/v1/kb/engine/orphans",
            "POST /api/v1/kb/engine/orphans/{nativeId}/resolve",
            "POST /api/v1/kb/engine/datasets/rename",
            "POST /api/v1/kb/engine/datasets/rename/rollback",
            "GET /api/v1/kb/engine/datasets/rename/logs",
            "GET /api/v1/kb/engine/datasets/rename/logs/{batchId}",
            "POST /api/v1/kb/categories",
            "PUT /api/v1/kb/categories/{id}",
            "DELETE /api/v1/kb/categories/{id}",
            "POST /api/v1/kb/libraries",
            "PUT /api/v1/kb/libraries/{id}",
            "PUT /api/v1/kb/libraries/{id}/engine/settings",
            "POST /api/v1/kb/libraries/{libraryId}/documents",
            "PUT /api/v1/kb/libraries/{libraryId}/documents/{id}/chunk-config",
            "PUT /api/v1/kb/libraries/{libraryId}/documents/{id}/enable",
            "POST /api/v1/kb/libraries/{libraryId}/documents/{id}/reparse",
            "POST /api/v1/kb/libraries/{libraryId}/documents/reparse-all",
            "DELETE /api/v1/kb/libraries/{libraryId}/documents/{id}",
            "POST /api/v1/kb/libraries/{libraryId}/acls",
            "DELETE /api/v1/kb/acls/{id}",
            "POST /api/v1/kb/libraries/{id}/graph/build",
            "GET /api/v1/kb/libraries/{id}/graph/build-status"
    );

    /** V6 已登记的 AI 能力 6 端点基线。 */
    private static final Set<String> AI_6_BASELINE = Set.of(
            "POST /api/v1/ai/summary",
            "POST /api/v1/ai/extract",
            "POST /api/v1/ai/rag",
            "POST /api/v1/ai/chat/completions",
            "GET /api/v1/ai/health",
            "GET /api/v1/ai/features"
    );

    /** 归一化正则：{id:[0-9]+} → {id}。 */
    private static final Pattern VAR_REGEX = Pattern.compile("\\{([A-Za-z][A-Za-z0-9]*):[^}]*}");

    @Test
    @DisplayName("SEC-02 差集盘点：KB 导出全登记 + 净新增 28，AI 反向端点 2 个，非 KB 未登记逐项列清单")
    void diffSurveyAgainstRegistry() throws Exception {
        Map<RequestMappingInfo, HandlerMethod> handlers = exportAllHandlerMethods();
        Set<String> exported = normalizeEndpoints(handlers);

        // 仅盘点 PEP 注册域 /api/v1/**（/internal/** 由 InternalServiceTrustInterceptor 管，不在本期范围）
        Set<String> apiV1 = exported.stream()
                .filter(e -> e.contains(" /api/v1/"))
                .collect(Collectors.toCollection(TreeSet::new));

        Set<String> registered = normalizeRegistered(REGISTERED_FIXTURE);
        Set<String> kbExported = apiV1.stream()
                .filter(e -> e.contains(" /api/v1/kb/"))
                .collect(Collectors.toCollection(TreeSet::new));
        Set<String> kbUnregistered = kbExported.stream()
                .filter(e -> !isCovered(e, registered))
                .collect(Collectors.toCollection(TreeSet::new));

        // ---- 断言 1：KB 域导出端点必须全部已登记（V32 落地后零差集；迁移 fixture 与 Controller 映射逐字对齐）----
        assertEquals(Set.of(), kbUnregistered,
                "KB 域导出端点存在未登记项——V32 迁移 fixture 未覆盖（Controller 映射与迁移不一致）："
                        + kbUnregistered);

        // ---- 断言 2：V32 净新增登记 == 恰好 28（READ-01~24 + WRITE-01~04，零遗漏零超卖）----
        Set<String> registeredKb = registered.stream()
                .filter(e -> e.contains(" /api/v1/kb/"))
                .collect(Collectors.toCollection(TreeSet::new));
        Set<String> newKb = new TreeSet<>(registeredKb);
        newKb.removeAll(KB_42_BASELINE);
        assertEquals(EXPECTED_KB_28, newKb,
                "V32 净新增 KB 登记必须恰好等于 READ-01~24 + WRITE-01~04；"
                        + "多出 = 超范围登记，缺少 = 补登遗漏（对照设计 §1.7 登记表）");

        // ---- 断言 3：AI 反向信任端点 2 个已登记（U1 裁决 V33 authOnly）----
        Set<String> aiExported = apiV1.stream()
                .filter(e -> e.contains(" /api/v1/ai/"))
                .collect(Collectors.toCollection(TreeSet::new));
        Set<String> aiUnregistered = aiExported.stream()
                .filter(e -> !isCovered(e, registered))
                .collect(Collectors.toCollection(TreeSet::new));
        assertEquals(Set.of(), aiUnregistered,
                "AI 域导出端点存在未登记项（U1 已裁决 V33 authOnly 登记 skill/execute|apply）："
                        + aiUnregistered);
        Set<String> registeredAi = registered.stream()
                .filter(e -> e.contains(" /api/v1/ai/"))
                .collect(Collectors.toCollection(TreeSet::new));
        Set<String> newAi = new TreeSet<>(registeredAi);
        newAi.removeAll(AI_6_BASELINE);
        assertEquals(EXPECTED_AI_AUTHONLY_2, newAi,
                "V33 净新增 AI 登记必须恰好是 skill/execute|apply 两个端点（U1 裁决）");

        // ---- 断言 4：其余非 KB 域未登记端点逐项输出（SEC-02 只盘点不改造）----
        Set<String> nonKbUnregistered = apiV1.stream()
                .filter(e -> !e.contains(" /api/v1/kb/"))
                .filter(e -> !e.contains(" /api/v1/ai/"))
                .filter(e -> !isCovered(e, registered))
                .collect(Collectors.toCollection(TreeSet::new));

        // 非 KB 未登记端点必须在差集清单文档中逐项有处置结论（U4：不得静默放行）
        assertTrue(nonKbUnregistered.stream().allMatch(e -> DISPOSITIONS.containsKey(domainOf(e))),
                "非 KB 未登记端点所属域未在差集清单给出处置结论："
                        + nonKbUnregistered.stream().map(BffApiRegistryDiffSurveyTest::domainOf).distinct()
                        .collect(Collectors.joining(", ")));

        // V35 落地后非 KB 未登记只剩 agent-ops 3 个动作变量端点（{action:start|pause|...} 单映射多动作，
        // 注册表已按动作拆行登记、运行时 AntPathMatcher 均能命中——差集清单 §5 R5 口径视为「已覆盖」，
        // 仅未来新增动作值时才需补登记）；modules 10 已 V35 登记、roles/apps/employees 已登记纠偏。
        assertEquals(Set.of(
                        "POST /api/v1/agent-ops/agents/{id}/{action}",
                        "POST /api/v1/agent-ops/channels/wecom/bots/{botId}/{action}",
                        "POST /api/v1/agent-ops/mcp/servers/{name}/{action}"),
                nonKbUnregistered,
                "非 KB 未登记应只剩 agent-ops 动作变量端点（拆行登记已覆盖）；"
                        + "modules 10 应已 V35 登记、roles/apps/employees 应已登记纠偏："
                        + nonKbUnregistered);

        printSurvey(exported, registered, newKb, newAi, nonKbUnregistered);
    }

    // ---------------------------------------------------------------- 导出

    /**
     * 注册全部 19 个 Controller 到最小 {@link StaticApplicationContext}，让 Spring 映射机制
     * （含类级前缀拼接、方法条件解析）完整跑一遍——与线上路由解析一致（块① QA 同款手法）。
     */
    private static Map<RequestMappingInfo, HandlerMethod> exportAllHandlerMethods() throws Exception {
        StaticApplicationContext context = new StaticApplicationContext();
        registerAllControllers(context);
        context.refresh();

        RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
        mapping.setApplicationContext(context);
        mapping.afterPropertiesSet();
        return mapping.getHandlerMethods();
    }

    private static void registerAllControllers(StaticApplicationContext context) {
        context.getBeanFactory().registerSingleton("kbController", new KbController(
                mock(KbFacadeService.class), mock(UserPermissionLoader.class)));
        context.getBeanFactory().registerSingleton("kbSynonymController", new KbSynonymController(
                mock(KbSynonymFacadeService.class)));
        context.getBeanFactory().registerSingleton("orgController", new OrgController(
                mock(OrgFacadeService.class)));
        context.getBeanFactory().registerSingleton("employeeController", new EmployeeController(
                mock(OrgFacadeService.class)));
        context.getBeanFactory().registerSingleton("deptController", new DeptController(
                mock(OrgFacadeService.class)));
        context.getBeanFactory().registerSingleton("dashboardController", new DashboardController(
                mock(DashboardAggregateService.class)));
        context.getBeanFactory().registerSingleton("roleController", new RoleController(
                mock(RoleFacadeService.class)));
        context.getBeanFactory().registerSingleton("authMeController", new AuthMeController(
                mock(IamWebClient.class), mock(MenuAggregateService.class)));
        context.getBeanFactory().registerSingleton("moduleController", new ModuleController(
                mock(ModuleFacadeService.class)));
        context.getBeanFactory().registerSingleton("dictController", new DictController(
                mock(DictFacadeService.class)));
        context.getBeanFactory().registerSingleton("menuController", new MenuController(
                mock(MenuAggregateService.class)));
        context.getBeanFactory().registerSingleton("userController", new UserController(
                mock(UserAggregateService.class)));
        context.getBeanFactory().registerSingleton("appController", new AppController(
                mock(IamWebClient.class)));
        context.getBeanFactory().registerSingleton("agentOpsChannelController", new AgentOpsChannelController(
                mock(WecomBotFacadeService.class)));
        context.getBeanFactory().registerSingleton("agentOpsGrantController", new AgentOpsGrantController(
                mock(AgentOpsGrantService.class)));
        context.getBeanFactory().registerSingleton("aiProxyController", new AiProxyController(
                mock(AiPlatformClient.class), mock(AiCapabilityTranslator.class),
                mock(AiFeatureConfigService.class), mock(AiPlatformProperties.class),
                mock(SkillExecutionEngine.class), mock(DocWriteRegistry.class),
                mock(SkillPermissionChecker.class)));
        context.getBeanFactory().registerSingleton("agentOpsController", new AgentOpsController(
                mock(AgentOpsFacadeService.class)));
        context.getBeanFactory().registerSingleton("internalPermissionController", new InternalPermissionController(
                mock(SkillPermissionChecker.class)));
        context.getBeanFactory().registerSingleton("mcpPermissionController", new McpPermissionController(
                mock(McpPermissionService.class)));
    }

    /** 导出 (method, path) 归一化集合；同一 method+path 多条条件映射去重。 */
    private static Set<String> normalizeEndpoints(Map<RequestMappingInfo, HandlerMethod> handlers) {
        Set<String> result = new TreeSet<>();
        for (RequestMappingInfo info : handlers.keySet()) {
            String path = firstPath(info);
            if (path == null) {
                continue;
            }
            Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
            if (methods.isEmpty()) {
                // 无方法限定的映射按 GET 兜底计入（现行 Controller 无此形态，防御性处理）
                result.add("GET " + normalizePath(path));
                continue;
            }
            for (RequestMethod method : methods) {
                result.add(method.name() + " " + normalizePath(path));
            }
        }
        return result;
    }

    private static String firstPath(RequestMappingInfo info) {
        if (info.getPathPatternsCondition() != null
                && !info.getPathPatternsCondition().getPatternValues().isEmpty()) {
            return info.getPathPatternsCondition().getPatternValues().iterator().next();
        }
        if (info.getPatternsCondition() != null
                && !info.getPatternsCondition().getPatterns().isEmpty()) {
            return info.getPatternsCondition().getPatterns().iterator().next();
        }
        return null;
    }

    /** 注册表 fixture 归一化：{id:[0-9]+} → {id}，保持 method+path 集合。 */
    private static Set<String> normalizeRegistered(Collection<String> fixture) {
        Set<String> result = new TreeSet<>();
        for (String entry : fixture) {
            int sp = entry.indexOf(' ');
            String method = entry.substring(0, sp);
            String path = normalizePath(entry.substring(sp + 1));
            result.add(method + " " + path);
        }
        return result;
    }

    /** 路径归一化：{var:regex} → {var}（Spring 导出 {var}，注册表 {var:regex}）。 */
    private static String normalizePath(String path) {
        Matcher matcher = VAR_REGEX.matcher(path);
        return matcher.replaceAll("{$1}");
    }

    /**
     * 覆盖率判定：导出端点是否被注册表 fixture 覆盖。
     * <ol>
     *   <li>归一化后逐字命中（{@code {id:[0-9]+}} → {@code {id}}，与 V30/V31 同款）；</li>
     *   <li>正则动作变量 {@code {action:start|pause|...}}：任一候选字面路径已登记即视为覆盖
     *       （Controller 用一个映射表达多个动作，注册表按动作拆行，运行时 AntPathMatcher 均能命中）；</li>
     *   <li>Spring 尾段通配 {@code {*file}}：已登记路径以「通配前缀」开头即视为覆盖。</li>
     * </ol>
     */
    private static boolean isCovered(String exported, Set<String> registered) {
        if (registered.contains(exported)) {
            return true;
        }
        String method = exported.substring(0, exported.indexOf(' '));
        String path = exported.substring(exported.indexOf(' ') + 1);

        Matcher actionMatcher = Pattern.compile("\\{action:([^}]*)}").matcher(path);
        if (actionMatcher.find()) {
            for (String alt : actionMatcher.group(1).split("\\|")) {
                String expanded = path.substring(0, actionMatcher.start())
                        + alt
                        + path.substring(actionMatcher.end());
                if (registered.contains(method + " " + normalizePath(expanded))) {
                    return true;
                }
            }
            return false;
        }

        int star = path.indexOf("{*");
        if (star >= 0) {
            String prefix = path.substring(0, star);
            for (String entry : registered) {
                if (entry.startsWith(method + " " + prefix)) {
                    return true;
                }
            }
            return false;
        }
        return false;
    }

    private static String domainOf(String endpoint) {
        String path = endpoint.substring(endpoint.indexOf(' ') + 1);
        String rest = path.startsWith("/api/v1/") ? path.substring("/api/v1/".length()) : path;
        String domain = rest.split("/")[0];
        return switch (domain) {
            case "kb" -> "kb";
            case "ai" -> "ai";
            case "agent-ops" -> "agent-ops";
            default -> domain;
        };
    }

    private void printSurvey(Set<String> exported, Set<String> registered,
                             Set<String> newKb, Set<String> newAi,
                             Set<String> nonKbUnregistered) {
        System.out.println("=== SEC-02 差集盘点（运行时导出 vs sys_api 注册表 fixture）===");
        System.out.println("BFF 导出端点总数（含 /internal）：" + exported.size());
        System.out.println("导出 /api/v1/** 端点总数：" + exported.stream()
                .filter(e -> e.contains(" /api/v1/")).count());
        System.out.println("注册表 fixture 行数：" + registered.size());
        System.out.println();
        System.out.println("--- V32 净新增 KB 登记（= READ-01~24 + WRITE-01~04，28 条）---");
        newKb.forEach(System.out::println);
        System.out.println();
        System.out.println("--- V33 净新增 AI 登记（= skill/execute|apply，authOnly）---");
        newAi.forEach(System.out::println);
        System.out.println();
        System.out.println("--- 其余非 KB 域未登记（SEC-02 只盘点不改造，逐项处置见差集清单文档）---");
        nonKbUnregistered.forEach(System.out::println);
        System.out.println();
        System.out.println("--- 已登记端点（fixture，供交叉核对）---");
        registered.stream().sorted().forEach(System.out::println);
        System.out.println("=== END ===");
    }

    /** 差集清单文档中每个非 KB 域的处置结论（对应 docs/backend/mis-kb-security-sprint-diff-list-2026-08-12.md）。 */
    private static final Map<String, String> DISPOSITIONS = new LinkedHashMap<>();

    static {
        DISPOSITIONS.put("agent-ops", "待运营评估：智能体运营控制台 58 端点已全量登记，剩余未登记为新增端点或已收敛域，二期统一评审");
        DISPOSITIONS.put("ai", "建议 authOnly：skill/execute|apply 已由 U1 裁决 V33 authOnly 登记；其余 AI 端点 V6 已登记");
        DISPOSITIONS.put("auth", "待运营评估：认证域未登记端点需运维确认网关白名单口径");
        DISPOSITIONS.put("dashboard", "已登记（V2 seed）或待运营评估：仪表盘聚合端点核对后列二期");
        DISPOSITIONS.put("apps", "已登记（V5 sys_api 9006，menu 90 permission NULL → authOnly）：差集误报已纠偏，V35 不重复补");
        DISPOSITIONS.put("employees", "已登记（V4 sys_api 1011，menu 201 system:user:list）：差集误报已纠偏，V35 不重复补");
        DISPOSITIONS.put("modules", "V35 已补登：modules 10 端点（catalog 91157 + api 91158-91167）已登记，复用 V8 system:module:* 四码");
        DISPOSITIONS.put("roles", "已登记（V2 建 3008/3009，V4 改名 /roles/{id}/menus，menu 234 system:role:assignMenu）：差集误报已纠偏，V35 不重复补");
        DISPOSITIONS.put("internal", "豁免：/internal/** 由 InternalServiceTrustInterceptor 管理，不属 ApiPermissionInterceptor 域");
        DISPOSITIONS.put("menus", "已登记（V2 seed authOnly）或待运营评估");
        DISPOSITIONS.put("oper-logs", "已登记（V2 seed）");
        DISPOSITIONS.put("login-logs", "已登记（V2 seed）");
    }

    /**
     * 全仓迁移（V2~V31）写入 sys_api 的注册表 fixture：{@code "METHOD PATH"}。
     * 数据来源：grep V*.sql 中 sys_api VALUES 的 (http_method, path_pattern) 去重。
     * 新增迁移登记端点后必须同步追加本 fixture（含 V32/V33 落库行）。
     */
    private static final Set<String> REGISTERED_FIXTURE = new LinkedHashSet<>(List.of(
            // ---- V2 seed：IAM / ORG / DEPT / ROLE / MENU / DICT / DASHBOARD / LOG / AUTH ----
            "GET /api/v1/users",
            "GET /api/v1/users/{id}",
            "POST /api/v1/users",
            "PUT /api/v1/users/{id}",
            "DELETE /api/v1/users/{id}",
            "PUT /api/v1/users/{id}/status",
            "PUT /api/v1/users/{id}/reset-password",
            "PUT /api/v1/users/{id}/roles",
            "GET /api/v1/orgs",
            "GET /api/v1/orgs/{id}",
            "POST /api/v1/orgs",
            "PUT /api/v1/orgs/{id}",
            "DELETE /api/v1/orgs/{id}",
            "GET /api/v1/depts/tree",
            "GET /api/v1/depts/{id}",
            "POST /api/v1/depts",
            "PUT /api/v1/depts/{id}",
            "DELETE /api/v1/depts/{id}",
            "GET /api/v1/roles",
            "GET /api/v1/roles/{id}",
            "POST /api/v1/roles",
            "PUT /api/v1/roles/{id}",
            "DELETE /api/v1/roles/{id}",
            // V4 改名：roles 菜单绑定 /permissions → /menus（V2 建 3008/3009，V4 更新 path）
            "GET /api/v1/roles/{id}/menus",
            "PUT /api/v1/roles/{id}/menus",
            "GET /api/v1/roles/{id}/data-scope",
            "PUT /api/v1/roles/{id}/data-scope",
            "GET /api/v1/roles/enabled",
            "GET /api/v1/menus/tree",
            "GET /api/v1/menus/{id}",
            "POST /api/v1/menus",
            "PUT /api/v1/menus/{id}",
            "DELETE /api/v1/menus/{id}",
            "GET /api/v1/menus/{menuId}/apis",
            "PUT /api/v1/menus/{menuId}/apis",
            "GET /api/v1/menus/permissions",
            "GET /api/v1/menus/router",
            "GET /api/v1/apis/tree",
            "POST /api/v1/apis",
            "PUT /api/v1/apis/{id}",
            "DELETE /api/v1/apis/{id}",
            "GET /api/v1/dicts/types",
            "GET /api/v1/dicts/types/{id}",
            "POST /api/v1/dicts/types",
            "PUT /api/v1/dicts/types/{id}",
            "DELETE /api/v1/dicts/types/{id}",
            "GET /api/v1/dicts/items",
            "POST /api/v1/dicts/items",
            "PUT /api/v1/dicts/items/{id}",
            "DELETE /api/v1/dicts/items/{id}",
            "GET /api/v1/dashboard/stats",
            "GET /api/v1/login-logs",
            "GET /api/v1/oper-logs",
            "GET /api/v1/oper-logs/{id}",
            "GET /api/v1/auth/me",
            "GET /api/v1/auth/logout",
            "GET /api/v1/auth/password",
            // ---- V4：员工列表（sys_api 1011 → menu 201 system:user:list）----
            "GET /api/v1/employees",
            // ---- V5：应用列表（sys_api 9006 → menu 90 permission NULL，authOnly）----
            "GET /api/v1/apps",
            // ---- V6：AI 能力 ----
            "POST /api/v1/ai/summary",
            "POST /api/v1/ai/extract",
            "POST /api/v1/ai/rag",
            "POST /api/v1/ai/chat/completions",
            "GET /api/v1/ai/health",
            "GET /api/v1/ai/features",
            // ---- V17：KB 命中测试 ----
            "POST /api/v1/kb/hit-test",
            // ---- V18：KB 同义词 11 端点 ----
            "GET /api/v1/kb/synonyms",
            "GET /api/v1/kb/synonyms/{id}",
            "POST /api/v1/kb/synonyms",
            "PUT /api/v1/kb/synonyms/{id}",
            "DELETE /api/v1/kb/synonyms/{id}",
            "GET /api/v1/kb/synonyms/config",
            "PUT /api/v1/kb/synonyms/config",
            "GET /api/v1/kb/synonyms/export",
            "POST /api/v1/kb/synonyms/import/precheck",
            "POST /api/v1/kb/synonyms/import/commit",
            "GET /api/v1/kb/synonyms/import/{batchId}/rejected",
            // ---- V19/V20/V28/V29：agent-ops 域 ----
            "GET /api/v1/agent-ops/skills",
            "GET /api/v1/agent-ops/skills/stats",
            "GET /api/v1/agent-ops/skills/{id}",
            "POST /api/v1/agent-ops/skills",
            "PUT /api/v1/agent-ops/skills/{id}",
            "DELETE /api/v1/agent-ops/skills/{id}",
            "POST /api/v1/agent-ops/skills/{id}/enable",
            "POST /api/v1/agent-ops/skills/{id}/disable",
            "POST /api/v1/agent-ops/skills/reindex",
            "GET /api/v1/agent-ops/skills/{id}/grants",
            "PUT /api/v1/agent-ops/skills/{id}/grants",
            "GET /api/v1/agent-ops/roles",
            "GET /api/v1/agent-ops/agents",
            "GET /api/v1/agent-ops/agents/{id}",
            "POST /api/v1/agent-ops/agents/{id}/start",
            "POST /api/v1/agent-ops/agents/{id}/pause",
            "POST /api/v1/agent-ops/agents/{id}/resume",
            "POST /api/v1/agent-ops/agents/{id}/stop",
            "GET /api/v1/agent-ops/agents/{id}/health",
            "GET /api/v1/agent-ops/agents/{id}/skills",
            "PUT /api/v1/agent-ops/agents/{id}/skills",
            "GET /api/v1/agent-ops/agents/{id}/config-files",
            "GET /api/v1/agent-ops/agents/{id}/config-files/content",
            "PUT /api/v1/agent-ops/agents/{id}/config-files/content",
            "GET /api/v1/agent-ops/agents/{id}/coordination",
            "PUT /api/v1/agent-ops/agents/{id}/coordination",
            "GET /api/v1/agent-ops/sessions",
            "GET /api/v1/agent-ops/sessions/{id}",
            "GET /api/v1/agent-ops/sessions/{id}/messages",
            "DELETE /api/v1/agent-ops/sessions/{id}",
            "POST /api/v1/agent-ops/sessions/batch-delete",
            "POST /api/v1/agent-ops/chat/sessions",
            "POST /api/v1/agent-ops/chat/sessions/{id}/messages",
            "GET /api/v1/agent-ops/mcp/servers",
            "GET /api/v1/agent-ops/mcp/servers/health",
            "GET /api/v1/agent-ops/mcp/servers/{name}",
            "GET /api/v1/agent-ops/mcp/servers/{name}/tools",
            "POST /api/v1/agent-ops/mcp/servers",
            "POST /api/v1/agent-ops/mcp/servers/{name}/connect",
            "POST /api/v1/agent-ops/mcp/servers/{name}/disconnect",
            "POST /api/v1/agent-ops/mcp/servers/{name}/discover",
            "POST /api/v1/agent-ops/mcp/servers/{name}/call",
            "GET /api/v1/agent-ops/mcp/tools",
            "POST /api/v1/agent-ops/mcp/tools/cleanup-offline",
            "GET /api/v1/agent-ops/catalog",
            "PUT /api/v1/agent-ops/catalog",
            "GET /api/v1/agent-ops/dispatch/traces",
            "GET /api/v1/agent-ops/dispatch/route-logs",
            "GET /api/v1/agent-ops/dispatch/route-stats",
            "GET /api/v1/agent-ops/channels/wecom/bots",
            "GET /api/v1/agent-ops/channels/wecom/bots/health",
            "POST /api/v1/agent-ops/channels/wecom/bots",
            "PUT /api/v1/agent-ops/channels/wecom/bots/{botId}",
            "DELETE /api/v1/agent-ops/channels/wecom/bots/{botId}",
            "POST /api/v1/agent-ops/channels/wecom/bots/{botId}/enable",
            "POST /api/v1/agent-ops/channels/wecom/bots/{botId}/disable",
            "GET /api/v1/agent-ops/approvals",
            "POST /api/v1/agent-ops/approvals/{id}/decision",
            "GET /api/v1/agent-ops/monitor/overview",
            "POST /api/v1/agent-ops/monitor/failover/reset",
            // ---- V24/V25：KB 分类管理员 ----
            "GET /api/v1/kb/categories/manageable-ids",
            "PUT /api/v1/kb/categories/{id}/move",
            "POST /api/v1/kb/categories/{id}/admins",
            "DELETE /api/v1/kb/category-admins/{adminId}",
            "GET /api/v1/kb/categories/{id}/admins",
            // ---- V26：KB 引擎同步 ----
            "GET /api/v1/kb/libraries/{id}/engine-ref",
            "GET /api/v1/kb/engine/reconcile",
            "POST /api/v1/kb/engine/reconcile",
            // ---- V27：KB 引擎 P1 ----
            "GET /api/v1/kb/engine/orphans",
            "POST /api/v1/kb/engine/orphans/{nativeId}/resolve",
            "POST /api/v1/kb/engine/datasets/rename",
            "POST /api/v1/kb/engine/datasets/rename/rollback",
            "GET /api/v1/kb/engine/datasets/rename/logs",
            "GET /api/v1/kb/engine/datasets/rename/logs/{batchId}",
            // ---- V30：KB 写端点 17 ----
            "POST /api/v1/kb/categories",
            "PUT /api/v1/kb/categories/{id}",
            "DELETE /api/v1/kb/categories/{id}",
            "POST /api/v1/kb/libraries",
            "PUT /api/v1/kb/libraries/{id}",
            "PUT /api/v1/kb/libraries/{id}/engine/settings",
            "POST /api/v1/kb/libraries/{libraryId}/documents",
            "PUT /api/v1/kb/libraries/{libraryId}/documents/{id}/chunk-config",
            "PUT /api/v1/kb/libraries/{libraryId}/documents/{id}/enable",
            "POST /api/v1/kb/libraries/{libraryId}/documents/{id}/reparse",
            "POST /api/v1/kb/libraries/{libraryId}/documents/reparse-all",
            "DELETE /api/v1/kb/libraries/{libraryId}/documents/{id}",
            "POST /api/v1/kb/libraries/{libraryId}/acls",
            "DELETE /api/v1/kb/acls/{id}",
            // ---- V31：KB GraphRAG ----
            "POST /api/v1/kb/libraries/{id}/graph/build",
            "GET /api/v1/kb/libraries/{id}/graph/build-status",
            // ---- V32（本期）：KB 28 端点（预登记，防回归；V32 未落地前差集断言=28 会红灯，见文档说明）----
            "GET /api/v1/kb/categories",
            "GET /api/v1/kb/libraries",
            "GET /api/v1/kb/libraries/{id}",
            "GET /api/v1/kb/libraries/{id}/detail",
            "GET /api/v1/kb/libraries/{id}/engine/settings",
            "GET /api/v1/kb/libraries/{libraryId}/documents",
            "GET /api/v1/kb/libraries/{libraryId}/documents/{id}",
            "GET /api/v1/kb/libraries/{libraryId}/acls",
            "GET /api/v1/kb/qa/sessions/mine",
            "GET /api/v1/kb/qa/sessions/{sessionId}",
            "GET /api/v1/kb/qa/sessions/{sessionId}/feedback",
            "GET /api/v1/kb/operations/qa/sessions",
            "GET /api/v1/kb/operations/qa/sessions/{sessionId}",
            "GET /api/v1/kb/operations/qa/sessions-all",
            "GET /api/v1/kb/operations/qa/feedback",
            "GET /api/v1/kb/operations/stats",
            "GET /api/v1/kb/operations/qa/export",
            "GET /api/v1/kb/operations/qa/tickets",
            "GET /api/v1/kb/operations/qa/tickets/{ticketId}",
            "GET /api/v1/kb/operations/qa/tickets/by-session/{sessionId}",
            "GET /api/v1/kb/subjects/search",
            "GET /api/v1/kb/engine/health",
            "GET /api/v1/kb/engine/capabilities",
            "GET /api/v1/kb/engine/models",
            "DELETE /api/v1/kb/libraries/{id}",
            "POST /api/v1/kb/qa/feedback",
            "POST /api/v1/kb/operations/qa/tickets",
            "PATCH /api/v1/kb/operations/qa/tickets/{ticketId}",
            // ---- V33（本期）：AI 反向信任 authOnly ----
            "POST /api/v1/ai/skill/execute",
            "POST /api/v1/ai/skill/apply",
            // ---- V35（本期）：modules 10 端点（catalog 91157 + api 91158-91167，复用 system:module:* 四码）----
            "GET /api/v1/modules",
            "GET /api/v1/modules/{id}",
            "POST /api/v1/modules",
            "PUT /api/v1/modules/{id}",
            "DELETE /api/v1/modules/{id}",
            "GET /api/v1/modules/{moduleId}/apis",
            "POST /api/v1/modules/{moduleId}/apis",
            "PUT /api/v1/modules/apis/{apiId}",
            "DELETE /api/v1/modules/apis/{apiId}",
            "GET /api/v1/modules/{moduleId}/bindings"
    ));
}
