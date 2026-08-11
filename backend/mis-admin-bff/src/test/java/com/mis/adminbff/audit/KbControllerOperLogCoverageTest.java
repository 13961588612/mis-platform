package com.mis.adminbff.audit;

import com.mis.adminbff.controller.KbController;
import com.mis.adminbff.security.UserPermissionLoader;
import com.mis.adminbff.service.KbFacadeService;
import com.mis.common.web.audit.OperLog;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.context.support.StaticApplicationContext;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.mockito.Mockito.mock;

/**
 * R1 验收点：全量写端点清单与 {@code @OperLog} 清单比对（设计 §4 R1，同技术债 11.2 手法）。
 *
 * <p>用 Spring {@link RequestMappingHandlerMapping} 导出 {@link KbController} 的
 * <b>运行时</b>全量端点映射（含类级 {@code @RequestMapping("/api/v1/kb")} 前缀拼接），
 * 筛出写端点（POST/PUT/DELETE/PATCH），逐一校验「恰好一个 {@code @OperLog}」——
 * Controller 或门面方法<b>二者必居其一</b>：都挂会双写审计，都不挂会漏审（KE-01 零遗漏）。
 *
 * <p>审计注解位置遵循设计 §1.1 Q2：
 * <ul>
 *   <li>「修改类」写操作挂门面方法（携带 {@code KbAuditBefore} 快照入参，before=旧值）；</li>
 *   <li>「创建/上传/重试/引擎/QA 反馈工单」等无旧值语义的挂 Controller 方法。</li>
 * </ul>
 * 门面方法名与 Controller 方法名一一对应——本测试就是这道契约的看门狗：
 * 新增写端点未挂审计、或误把注解重复挂到两层，都会在这里红灯。
 *
 * <p>另校验注解参数（设计 §11.5）：{@code module="知识库"}、{@code operation} 非空、
 * {@code recordParams=true}（入参脱敏前置；KB 写端点入参均非凭据类）。
 */
class KbControllerOperLogCoverageTest {

    private static final Set<RequestMethod> WRITE_METHODS =
            Set.of(RequestMethod.POST, RequestMethod.PUT, RequestMethod.DELETE, RequestMethod.PATCH);

    @Test
    @DisplayName("每个写端点恰好一个 @OperLog（Controller 或门面），module/operation/recordParams 合规")
    void everyWriteEndpointHasExactlyOneOperLog() throws Exception {
        Map<RequestMappingInfo, HandlerMethod> handlers = exportHandlerMethods();
        List<String> violations = new ArrayList<>();
        List<String> inventory = new ArrayList<>();

        for (Map.Entry<RequestMappingInfo, HandlerMethod> entry : handlers.entrySet()) {
            RequestMappingInfo info = entry.getKey();
            Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
            if (methods.isEmpty() || Collections.disjoint(methods, WRITE_METHODS)) {
                continue; // 读端点或无方法限定：不在本期审计覆盖范围
            }
            HandlerMethod handler = entry.getValue();
            Method controllerMethod = handler.getMethod();
            String endpoint = describe(info);

            OperLog controllerLog = controllerMethod.getAnnotation(OperLog.class);
            Method facadeMethod = findFacadeMethod(controllerMethod.getName());
            assertNotNull(facadeMethod,
                    "Controller 写方法 " + controllerMethod.getName() + " 在 KbFacadeService 找不到同名门面方法，"
                            + "审计挂点契约被破坏，请检查 KbController 与 KbFacadeService 是否同步改名");
            OperLog facadeLog = facadeMethod.getAnnotation(OperLog.class);

            boolean onController = controllerLog != null;
            boolean onFacade = facadeLog != null;
            inventory.add(String.format("%-58s %-26s %s",
                    endpoint,
                    controllerMethod.getName(),
                    onController ? "Controller@" + controllerLog.operation()
                            : onFacade ? "Facade@" + facadeLog.operation()
                            : "!!! 无审计 !!!"));

            if (onController == onFacade) {
                violations.add(endpoint + " -> @OperLog 数量=" + (onController ? 2 : 0)
                        + "（必须恰好 1 个：Controller 或门面，不能都挂也不能都不挂）");
                continue;
            }
            OperLog effective = onController ? controllerLog : facadeLog;
            if (!"知识库".equals(effective.module())) {
                violations.add(endpoint + " -> module 文案异常：" + effective.module());
            }
            if (effective.operation() == null || effective.operation().isBlank()) {
                violations.add(endpoint + " -> operation 文案为空");
            }
            if (!effective.recordParams()) {
                violations.add(endpoint + " -> recordParams 必须为 true（审计入参脱敏前置，设计 §11.5）");
            }
        }

        // 全量写端点清单留痕，供 QA 抽样核对六要素（设计 §4 R1 验收点第一项）
        inventory.forEach(System.out::println);

        assertEquals(0, violations.size(),
                "写端点审计覆盖校验失败（KE-01 零遗漏）：\n" + String.join("\n", violations));
    }

    /**
     * 用 {@link RequestMappingHandlerMapping} 导出控制器运行时全量端点映射。
     *
     * <p>把真实 {@link KbController} 注册进最小 {@link StaticApplicationContext}，
     * 让 Spring 的映射机制（含类级前缀拼接、方法条件解析）完整跑一遍——这比手工
     * 反射读注解更接近线上真实路由，也正是「技术债 11.2 手法」的导出口径。
     */
    private static Map<RequestMappingInfo, HandlerMethod> exportHandlerMethods() throws Exception {
        KbController controller = new KbController(
                mock(KbFacadeService.class), mock(UserPermissionLoader.class));
        StaticApplicationContext context = new StaticApplicationContext();
        context.getBeanFactory().registerSingleton("kbController", controller);
        context.refresh();

        RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
        mapping.setApplicationContext(context);
        mapping.afterPropertiesSet();
        return mapping.getHandlerMethods();
    }

    private static Method findFacadeMethod(String name) {
        for (Method m : KbFacadeService.class.getDeclaredMethods()) {
            if (m.getName().equals(name)) {
                return m;
            }
        }
        return null;
    }

    private static String describe(RequestMappingInfo info) {
        String path = info.getPathPatternsCondition() != null
                ? info.getPathPatternsCondition().getPatternValues().toString()
                : info.getPatternsCondition() != null
                ? info.getPatternsCondition().getPatterns().toString()
                : "?";
        String http = info.getMethodsCondition().getMethods().toString();
        return String.format("%-6s %s", http, path);
    }
}
