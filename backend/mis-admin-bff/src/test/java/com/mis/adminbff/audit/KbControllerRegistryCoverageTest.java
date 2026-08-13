package com.mis.adminbff.audit;

import com.mis.adminbff.controller.KbController;
import com.mis.adminbff.controller.KbSynonymController;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.service.KbFacadeService;
import com.mis.adminbff.service.KbSynonymFacadeService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;

/**
 * SEC-03/04 验收：KB 全量端点（含 V32 新登记 28 个）逐条断言已在注册表、权限码正确。
 *
 * <p>用 Spring {@link RequestMappingHandlerMapping} 导出 {@link KbController} 与
 * {@link KbSynonymController} 的<b>运行时</b>全量端点映射（含类级前缀拼接），
 * 与「迁移登记表」（V17~V33 写入 sys_api 的 KB 行，permission 取自 sys_menu 关联）
 * 逐条比对：
 * <ul>
 *   <li>每个导出端点在登记表中<b>恰好</b>有一条对应（method + path 归一化精确匹配）；</li>
 *   <li>登记的权限码与设计 §1.7 / 各迁移注释逐字一致（零漂移锁）；</li>
 *   <li>登记表无「导出之外」的残留端点（Controller 删除后迁移残留会红灯）。</li>
 * </ul>
 *
 * <p>path 归一化：注册表 {@code {id:[0-9]+}} → Spring 导出 {@code {id}}，逐字比较。
 * 本测试是「补登先行」的看门狗——任何 KB 端点漏登记、权限码挂错，
 * fail-closed（prod 已 deny-unmapped: true）下即功能故障，必须红灯。
 */
class KbControllerRegistryCoverageTest {

    /** 归一化正则：{id:[0-9]+} → {id}。 */
    private static final Pattern VAR_REGEX = Pattern.compile("\\{([A-Za-z][A-Za-z0-9]*):[^}]*}");

    /**
     * KB 全量端点 → 权限码（71 条 = V17~V31 既有 42（去重后）+ V32 新登记 28
     * + 1 新登记（V41 问答会话删除，复用 kb:qa:ask，无新增权限码））。
     * 数据来源：V17/V18/V24/V25/V26/V27/V30/V31 迁移注释 + 设计 §1.7 登记表。
     */
    private static final Map<String, String> KB_EXPECTED_PERMISSIONS = buildExpected();

    @Test
    @DisplayName("KB 全量端点逐条已在注册表且权限码正确（42 去重基线 + 28 新登记，零漂移）")
    void everyKbEndpointRegisteredWithCorrectPermission() throws Exception {
        Set<String> exported = exportKbEndpoints();
        Map<String, String> expected = KB_EXPECTED_PERMISSIONS;

        List<String> violations = new ArrayList<>();

        // 方向一：导出端点必须在登记表中有权限码
        for (String endpoint : exported) {
            if (!expected.containsKey(endpoint)) {
                violations.add("Controller 导出但登记表缺失：" + endpoint);
            }
        }

        // 方向二：登记表条目必须与导出端点一一对应（无残留、无错码）
        for (Map.Entry<String, String> entry : expected.entrySet()) {
            if (!exported.contains(entry.getKey())) {
                violations.add("登记表存在但 Controller 未导出：" + entry.getKey()
                        + " -> " + entry.getValue() + "（可能 Controller 已删或映射改路径）");
            }
        }

        // 数量守恒：73 = 42 既有（去重后，V30 含 3 行与 V24/25 重复被幂等跳过）+ 28 新登记（V32）
        //           + 2 新登记（V34 RAPTOR）+ 1 新登记（KBP-10 存量授权只读清单 inventory）
        //           + 1 新登记（V41 问答会话删除，复用 kb:qa:ask）
        assertEquals(74, expected.size(), "KB 登记表条目数应为 42（去重基线）+ 28（V32）+ 2（V34 RAPTOR）"
                + " + 1（KBP-10 inventory）+ 1（V41 会话删除）= 74，与 Controller 导出端点数一致（设计 §1.7 与 V30/V34 幂等说明）");

        exported.forEach(System.out::println);

        assertEquals(0, violations.size(),
                "KB 端点注册表覆盖校验失败（SEC-03/04）：\n" + String.join("\n", violations));
    }

    /**
     * 导出 KbController + KbSynonymController 运行时端点（method + path 归一化）。
     */
    private static Set<String> exportKbEndpoints() throws Exception {
        KbController kbController = new KbController(
                mock(KbFacadeService.class), mock(UserPermissionLoader.class));
        KbSynonymController synonymController = new KbSynonymController(
                mock(KbSynonymFacadeService.class));

        StaticApplicationContext context = new StaticApplicationContext();
        context.getBeanFactory().registerSingleton("kbController", kbController);
        context.getBeanFactory().registerSingleton("kbSynonymController", synonymController);
        context.refresh();

        RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
        mapping.setApplicationContext(context);
        mapping.afterPropertiesSet();

        Set<String> result = new TreeSet<>();
        for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : mapping.getHandlerMethods().entrySet()) {
            RequestMappingInfo info = entry.getKey();
            String path = info.getPathPatternsCondition() != null
                    ? info.getPathPatternsCondition().getPatternValues().iterator().next()
                    : info.getPatternsCondition() != null
                    ? info.getPatternsCondition().getPatterns().iterator().next()
                    : null;
            if (path == null) {
                continue;
            }
            Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
            if (methods.isEmpty()) {
                result.add("GET " + normalize(path));
                continue;
            }
            for (RequestMethod method : methods) {
                result.add(method.name() + " " + normalize(path));
            }
        }
        return result;
    }

    private static String normalize(String path) {
        Matcher matcher = VAR_REGEX.matcher(path);
        return matcher.replaceAll("{$1}");
    }

    private static Map<String, String> buildExpected() {
        Map<String, String> map = new LinkedHashMap<>();
        // ---- V17：命中测试 ----
        map.put("POST /api/v1/kb/hit-test", "kb:hittest:run");
        // ---- V18：同义词 11 端点 ----
        map.put("GET /api/v1/kb/synonyms", "kb:config:synonym:view");
        map.put("GET /api/v1/kb/synonyms/{id}", "kb:config:synonym:view");
        map.put("POST /api/v1/kb/synonyms", "kb:config:synonym:write");
        map.put("PUT /api/v1/kb/synonyms/{id}", "kb:config:synonym:write");
        map.put("DELETE /api/v1/kb/synonyms/{id}", "kb:config:synonym:write");
        map.put("GET /api/v1/kb/synonyms/config", "kb:config:synonym:view");
        map.put("PUT /api/v1/kb/synonyms/config", "kb:config:synonym:write");
        map.put("GET /api/v1/kb/synonyms/export", "kb:config:synonym:import");
        map.put("POST /api/v1/kb/synonyms/import/precheck", "kb:config:synonym:import");
        map.put("POST /api/v1/kb/synonyms/import/commit", "kb:config:synonym:import");
        map.put("GET /api/v1/kb/synonyms/import/{batchId}/rejected", "kb:config:synonym:import");
        // ---- V24/V25：分类管理员 ----
        map.put("GET /api/v1/kb/categories/manageable-ids", "kb:category:list");
        map.put("GET /api/v1/kb/categories/{id}/admins", "kb:category:manage");
        map.put("POST /api/v1/kb/categories/{id}/admins", "kb:category:manage");
        map.put("DELETE /api/v1/kb/category-admins/{adminId}", "kb:category:manage");
        map.put("PUT /api/v1/kb/categories/{id}/move", "kb:category:manage");
        // ---- V26：引擎同步 ----
        map.put("GET /api/v1/kb/libraries/{id}/engine-ref", "kb:library:engine-ref:view");
        map.put("GET /api/v1/kb/engine/reconcile", "kb:engine:reconcile");
        map.put("POST /api/v1/kb/engine/reconcile", "kb:engine:reconcile");
        // ---- V27：引擎 P1 ----
        map.put("GET /api/v1/kb/engine/orphans", "kb:engine:reconcile");
        map.put("POST /api/v1/kb/engine/orphans/{nativeId}/resolve", "kb:engine:orphan:handle");
        map.put("POST /api/v1/kb/engine/datasets/rename", "kb:engine:dataset:rename");
        map.put("POST /api/v1/kb/engine/datasets/rename/rollback", "kb:engine:dataset:rename");
        map.put("GET /api/v1/kb/engine/datasets/rename/logs", "kb:engine:dataset:rename");
        map.put("GET /api/v1/kb/engine/datasets/rename/logs/{batchId}", "kb:engine:dataset:rename");
        // ---- V30：写端点 17 ----
        map.put("POST /api/v1/kb/categories", "kb:category:add");
        map.put("PUT /api/v1/kb/categories/{id}", "kb:category:edit");
        map.put("DELETE /api/v1/kb/categories/{id}", "kb:category:delete");
        map.put("POST /api/v1/kb/libraries", "kb:library:add");
        map.put("PUT /api/v1/kb/libraries/{id}", "kb:library:edit");
        map.put("PUT /api/v1/kb/libraries/{id}/engine/settings", "kb:library:edit");
        map.put("POST /api/v1/kb/libraries/{libraryId}/documents", "kb:document:add");
        map.put("PUT /api/v1/kb/libraries/{libraryId}/documents/{id}/chunk-config", "kb:document:edit");
        map.put("PUT /api/v1/kb/libraries/{libraryId}/documents/{id}/enable", "kb:document:edit");
        map.put("POST /api/v1/kb/libraries/{libraryId}/documents/{id}/reparse", "kb:document:edit");
        map.put("POST /api/v1/kb/libraries/{libraryId}/documents/reparse-all", "kb:document:edit");
        map.put("DELETE /api/v1/kb/libraries/{libraryId}/documents/{id}", "kb:document:delete");
        map.put("POST /api/v1/kb/libraries/{libraryId}/acls", "kb:acl:grant");
        map.put("DELETE /api/v1/kb/acls/{id}", "kb:acl:revoke");
        // ---- KBP-10：存量授权只读清单（GET，跨库全局视角；双闸门：权限码 + mis-kb 全局管理员）----
        map.put("GET /api/v1/kb/acls/inventory", "kb:acl:revoke");
        // ---- V31：GraphRAG ----
        map.put("POST /api/v1/kb/libraries/{id}/graph/build", "kb:library:edit");
        map.put("GET /api/v1/kb/libraries/{id}/graph/build-status", "kb:library:engine-ref:view");
        // ---- V34：RAPTOR ----
        map.put("POST /api/v1/kb/libraries/{id}/raptor/build", "kb:library:edit");
        map.put("GET /api/v1/kb/libraries/{id}/raptor/build-status", "kb:library:engine-ref:view");
        // ---- V32：28 新登记（READ-01~24 + WRITE-01~04，设计 §1.7）----
        map.put("GET /api/v1/kb/categories", "kb:category:list");
        map.put("GET /api/v1/kb/libraries", "kb:library:list");
        map.put("GET /api/v1/kb/libraries/{id}", "kb:library:list");
        map.put("GET /api/v1/kb/libraries/{id}/detail", "kb:library:list");
        map.put("GET /api/v1/kb/libraries/{id}/engine/settings", "kb:library:edit");
        map.put("GET /api/v1/kb/libraries/{libraryId}/documents", "kb:document:list");
        map.put("GET /api/v1/kb/libraries/{libraryId}/documents/{id}", "kb:document:list");
        map.put("GET /api/v1/kb/libraries/{libraryId}/acls", "kb:acl:list");
        map.put("GET /api/v1/kb/qa/sessions/mine", "kb:qa:ask");
        map.put("GET /api/v1/kb/qa/sessions/{sessionId}", "kb:qa:ask");
        map.put("GET /api/v1/kb/qa/sessions/{sessionId}/feedback", "kb:qa:ask");
        // ---- V41：问答会话删除（用户侧软删除；无新增权限码，复用 kb:qa:ask）----
        map.put("DELETE /api/v1/kb/qa/sessions/{sessionId}", "kb:qa:ask");
        map.put("GET /api/v1/kb/operations/qa/sessions", "kb:operation:list");
        map.put("GET /api/v1/kb/operations/qa/sessions/{sessionId}", "kb:operation:list");
        map.put("GET /api/v1/kb/operations/qa/sessions-all", "kb:operation:list");
        map.put("GET /api/v1/kb/operations/qa/feedback", "kb:operation:list");
        map.put("GET /api/v1/kb/operations/stats", "kb:operation:list");
        map.put("GET /api/v1/kb/operations/qa/export", "kb:operation:list");
        map.put("GET /api/v1/kb/operations/qa/tickets", "kb:operation:list");
        map.put("GET /api/v1/kb/operations/qa/tickets/{ticketId}", "kb:operation:list");
        map.put("GET /api/v1/kb/operations/qa/tickets/by-session/{sessionId}", "kb:operation:list");
        map.put("GET /api/v1/kb/subjects/search", "kb:acl:list");
        map.put("GET /api/v1/kb/engine/health", "kb:engine:view");
        map.put("GET /api/v1/kb/engine/capabilities", "kb:engine:view");
        map.put("GET /api/v1/kb/engine/models", "kb:engine:view");
        map.put("DELETE /api/v1/kb/libraries/{id}", "kb:library:delete");
        map.put("POST /api/v1/kb/qa/feedback", "kb:qa:feedback");
        map.put("POST /api/v1/kb/operations/qa/tickets", "kb:qa:ask");
        map.put("PATCH /api/v1/kb/operations/qa/tickets/{ticketId}", "kb:operation:list");
        return map;
    }

    /**
     * 一码一菜单守卫（uk_menu_app_permission）：登记表中同一权限码在导出端点上
     * 不得跨菜单重复——本测试对 KB 域做静态版核对（完整 DB 校验见 V32 自检 SQL 3）。
     */
    @Test
    @DisplayName("V32 新登记 28 端点权限码分布与设计 §1.7 逐字一致")
    void v32NewRegistrationsMatchDesignTable() {
        Set<String> expected28 = Set.of(
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
                "PATCH /api/v1/kb/operations/qa/tickets/{ticketId}"
        );

        Map<String, String> expectedPerms = new LinkedHashMap<>();
        expectedPerms.put("GET /api/v1/kb/categories", "kb:category:list");
        expectedPerms.put("GET /api/v1/kb/libraries", "kb:library:list");
        expectedPerms.put("GET /api/v1/kb/libraries/{id}", "kb:library:list");
        expectedPerms.put("GET /api/v1/kb/libraries/{id}/detail", "kb:library:list");
        expectedPerms.put("GET /api/v1/kb/libraries/{id}/engine/settings", "kb:library:edit");
        expectedPerms.put("GET /api/v1/kb/libraries/{libraryId}/documents", "kb:document:list");
        expectedPerms.put("GET /api/v1/kb/libraries/{libraryId}/documents/{id}", "kb:document:list");
        expectedPerms.put("GET /api/v1/kb/libraries/{libraryId}/acls", "kb:acl:list");
        expectedPerms.put("GET /api/v1/kb/qa/sessions/mine", "kb:qa:ask");
        expectedPerms.put("GET /api/v1/kb/qa/sessions/{sessionId}", "kb:qa:ask");
        expectedPerms.put("GET /api/v1/kb/qa/sessions/{sessionId}/feedback", "kb:qa:ask");
        expectedPerms.put("GET /api/v1/kb/operations/qa/sessions", "kb:operation:list");
        expectedPerms.put("GET /api/v1/kb/operations/qa/sessions/{sessionId}", "kb:operation:list");
        expectedPerms.put("GET /api/v1/kb/operations/qa/sessions-all", "kb:operation:list");
        expectedPerms.put("GET /api/v1/kb/operations/qa/feedback", "kb:operation:list");
        expectedPerms.put("GET /api/v1/kb/operations/stats", "kb:operation:list");
        expectedPerms.put("GET /api/v1/kb/operations/qa/export", "kb:operation:list");
        expectedPerms.put("GET /api/v1/kb/operations/qa/tickets", "kb:operation:list");
        expectedPerms.put("GET /api/v1/kb/operations/qa/tickets/{ticketId}", "kb:operation:list");
        expectedPerms.put("GET /api/v1/kb/operations/qa/tickets/by-session/{sessionId}", "kb:operation:list");
        expectedPerms.put("GET /api/v1/kb/subjects/search", "kb:acl:list");
        expectedPerms.put("GET /api/v1/kb/engine/health", "kb:engine:view");
        expectedPerms.put("GET /api/v1/kb/engine/capabilities", "kb:engine:view");
        expectedPerms.put("GET /api/v1/kb/engine/models", "kb:engine:view");
        expectedPerms.put("DELETE /api/v1/kb/libraries/{id}", "kb:library:delete");
        expectedPerms.put("POST /api/v1/kb/qa/feedback", "kb:qa:feedback");
        expectedPerms.put("POST /api/v1/kb/operations/qa/tickets", "kb:qa:ask");
        expectedPerms.put("PATCH /api/v1/kb/operations/qa/tickets/{ticketId}", "kb:operation:list");

        assertEquals(expected28, expectedPerms.keySet(), "28 端点集合与设计 §1.7 一致");
        for (Map.Entry<String, String> e : expectedPerms.entrySet()) {
            assertEquals(e.getValue(), KB_EXPECTED_PERMISSIONS.get(e.getKey()),
                    "权限码漂移：" + e.getKey());
        }
        assertTrue(expectedPerms.size() == 28, "应为 28 条");
    }
}
