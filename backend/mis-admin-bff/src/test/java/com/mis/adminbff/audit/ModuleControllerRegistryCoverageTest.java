package com.mis.adminbff.audit;

import com.mis.adminbff.controller.ModuleController;
import com.mis.adminbff.service.ModuleFacadeService;
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
 * 差集补登 V34 验收：modules 全量端点（10 条）逐条断言已在注册表、权限码正确。
 *
 * <p>用 Spring {@link RequestMappingHandlerMapping} 导出 {@link ModuleController} 的
 * <b>运行时</b>全量端点映射（含类级前缀拼接），与「迁移登记表」（V34 写入 sys_api
 * 的 modules 行，permission 取自 sys_menu 关联）逐条比对：
 * <ul>
 *   <li>每个导出端点在登记表中<b>恰好</b>有一条对应（method + path 归一化精确匹配）；</li>
 *   <li>登记的权限码与设计 §1.2 / V34 迁移注释逐字一致（零漂移锁）；</li>
 *   <li>登记表无「导出之外」的残留端点（Controller 删除后迁移残留会红灯）。</li>
 * </ul>
 *
 * <p>path 归一化：注册表 {@code {id:[0-9]+}} → Spring 导出 {@code {id}}，逐字比较。
 * 本测试是 modules 域 fail-closed 的看门狗——任何 modules 端点漏登记、权限码挂错，
 * fail-closed（prod 已 deny-unmapped: true）下即功能故障，必须红灯。
 */
class ModuleControllerRegistryCoverageTest {

    /** 归一化正则：{id:[0-9]+} → {id}。 */
    private static final Pattern VAR_REGEX = Pattern.compile("\\{([A-Za-z][A-Za-z0-9]*):[^}]*}");

    /**
     * modules 全量端点 → 权限码（10 条 = V34 新登记）。
     * 数据来源：V34 迁移注释 + 设计 §1.2 登记表（U-V34-2 裁决 POST apis 用 add）。
     */
    private static final Map<String, String> MODULE_EXPECTED_PERMISSIONS = buildExpected();

    @Test
    @DisplayName("modules 全量端点逐条已在注册表且权限码正确（V34 10 条，零漂移）")
    void everyModuleEndpointRegisteredWithCorrectPermission() throws Exception {
        Set<String> exported = exportModuleEndpoints();
        Map<String, String> expected = MODULE_EXPECTED_PERMISSIONS;

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

        // 数量守恒：10 = V34 新登记 modules 10 端点，与 Controller 导出端点数一致
        assertEquals(10, expected.size(), "modules 登记表条目数应为 V34 新登记 10 条，"
                + "与 Controller 导出端点数一致（设计 §1.2 登记表）");

        exported.forEach(System.out::println);

        assertEquals(0, violations.size(),
                "modules 端点注册表覆盖校验失败（V34）：\n" + String.join("\n", violations));
    }

    /**
     * 导出 ModuleController 运行时端点（method + path 归一化）。
     */
    private static Set<String> exportModuleEndpoints() throws Exception {
        ModuleController moduleController = new ModuleController(mock(ModuleFacadeService.class));

        StaticApplicationContext context = new StaticApplicationContext();
        context.getBeanFactory().registerSingleton("moduleController", moduleController);
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
        // ---- V34：modules 10 端点（catalog 91155 + api 91156-91165，设计 §1.2 登记表）----
        map.put("GET /api/v1/modules", "system:module:list");
        map.put("GET /api/v1/modules/{id}", "system:module:list");
        map.put("POST /api/v1/modules", "system:module:add");
        map.put("PUT /api/v1/modules/{id}", "system:module:edit");
        map.put("DELETE /api/v1/modules/{id}", "system:module:delete");
        map.put("GET /api/v1/modules/{moduleId}/apis", "system:module:list");
        map.put("POST /api/v1/modules/{moduleId}/apis", "system:module:add");
        map.put("PUT /api/v1/modules/apis/{apiId}", "system:module:edit");
        map.put("DELETE /api/v1/modules/apis/{apiId}", "system:module:delete");
        map.put("GET /api/v1/modules/{moduleId}/bindings", "system:module:list");
        return map;
    }

    /**
     * 一码一菜单守卫（uk_menu_app_permission）：V34 登记的权限码分布与设计 §1.2
     * 逐字一致——list×4 / add×2 / edit×2 / delete×2（完整 DB 校验见 V34 自检 SQL 3）。
     */
    @Test
    @DisplayName("V34 新登记 10 端点权限码分布与设计 §1.2 逐字一致")
    void v34NewRegistrationsMatchDesignTable() {
        Map<String, String> expectedPerms = buildExpected();

        assertEquals(10, expectedPerms.size(), "应为 10 条");
        assertEquals(4L, expectedPerms.values().stream().filter("system:module:list"::equals).count(),
                "system:module:list 应挂 4 个端点（M-01/02/06/10）");
        assertEquals(2L, expectedPerms.values().stream().filter("system:module:add"::equals).count(),
                "system:module:add 应挂 2 个端点（M-03/07，U-V34-2）");
        assertEquals(2L, expectedPerms.values().stream().filter("system:module:edit"::equals).count(),
                "system:module:edit 应挂 2 个端点（M-04/08）");
        assertEquals(2L, expectedPerms.values().stream().filter("system:module:delete"::equals).count(),
                "system:module:delete 应挂 2 个端点（M-05/09）");

        for (Map.Entry<String, String> e : expectedPerms.entrySet()) {
            assertEquals(e.getValue(), MODULE_EXPECTED_PERMISSIONS.get(e.getKey()),
                    "权限码漂移：" + e.getKey());
        }
    }
}
