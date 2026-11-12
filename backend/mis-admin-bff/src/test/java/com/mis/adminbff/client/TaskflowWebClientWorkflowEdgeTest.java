package com.mis.adminbff.client;

import com.mis.adminbff.client.model.WfDefinitionDTO;
import com.mis.adminbff.config.BffProperties;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.ClientResponse;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

import java.lang.reflect.RecordComponent;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * BFF 透传流程定义详情时**不得丢 {@code edges}** 的回归测试。
 *
 * <h2>缺陷回放</h2>
 * BFF 的 {@code WfDefinitionDTO} record 曾经少了 {@code edges} 分量。mis-taskflow 的
 * {@code WfDefinitionService#toDto} 一直正确地查了 {@code wf_edge} 并返回连线，
 * 但 BFF 反序列化时因Spring Boot 默认 {@code FAIL_ON_UNKNOWN_PROPERTIES=false}
 * 把整个 {@code edges} 数组<b>静默丢弃</b>——没有报错、没有日志、HTTP 200。
 *
 *<p>用户侧表现（且与「保存失败」症状高度重合，容易误判方向）：
 * <ol>
 *   <li>点「编排」进设计器：节点都在，<b>一条连线都没有</b>；</li>
 *   <li>手工重���连线 → 保存 → 退出 → 再进：<b>连线又没了</b>。</li>
 * </ol>
 * 第二步尤其误导人：其实保存是<b>成功</b>的（写入路径 {@code updateWorkflowDefinition} 走
 * {@code Map<String,Object> } 透传 body，不经过本 record，所以 edges 一直是写进去的），
 * 丢的只是<b>读回</b>。曾因此把排查方向错推到「前端映射不对称」和「validateWorkflow拦下了保存」。
 *
 * <h2>为什么单测能守住</h2>
 * 本测试把下游 JSON 原文喂给<b>真实的 {@link TaskflowWebClient}</b>，断言返回的 DTO 里
 * {@code edges} 非空且source/target 是 nodeCode。任何人不小心从 record 里删掉该分量，
 * 这里立刻红。
 */
class TaskflowWebClientWorkflowEdgeTest {

    private static final String BASE = "http://taskflow.upstream.test:8104";

    /**
     * 与 mis-taskflow {@code WfDefinitionService#toDto} 的真实输出同构：
     * 3 节点 + 2 条边，边里source/target 是 {@code nodeCode}（不是画布 id）。
     */
    private static final String DEFINITION_WITH_EDGES = """
            {"code":0,"message":"ok","data":{
              "id":"950001","tenantId":"1","code":"PURCHASE_APPROVAL_DEMO",
              "name":"采购审批（示例）","category":"APPROVAL","description":"d",
              "version":1,"status":"DRAFT","supportedFormCodes":["PUR_FORM"],
              "formSchema":null,"config":"{}",
              "nodes":[
                {"nodeCode":"start","nodeName":"提交申请","nodeType":"START","sortOrder":0,
                 "canvasX":-266.0,"canvasY":22.0,"conditionExpr":null,"assigneeRule":"{}",
                 "timeoutHours":null,"config":"{}"},
                {"nodeCode":"approve","nodeName":"主管审批","nodeType":"APPROVAL","sortOrder":1,
                 "canvasX":30.5,"canvasY":32.7,"conditionExpr":null,
                 "assigneeRule":"{\\"type\\": \\"SELF\\"}","timeoutHours":24,"config":"{}"},
                {"nodeCode":"end","nodeName":"归档","nodeType":"END","sortOrder":2,
                 "canvasX":-117.5,"canvasY":-70.0,"conditionExpr":null,"assigneeRule":"{}",
                 "timeoutHours":null,"config":"{}"}],
              "edges":[
                {"source":"start","target":"approve","edgeType":"DEFAULT","label":null,
                 "conditionExpr":null,"sortOrder":0},
                {"source":"approve","target":"end","edgeType":"DEFAULT","label":null,
                 "conditionExpr":null,"sortOrder":1}],
              "createdAt":null,"updatedAt":null,"categoryId":null}}""";

    /** 老定义：后端可能没有边（此时 edges 缺失也不能抛异常）。 */
    private static final String DEFINITION_WITHOUT_EDGES = """
            {"code":0,"message":"ok","data":{
              "id":"950001","tenantId":"1","code":"PURCHASE_APPROVAL_DEMO",
              "name":"采购审批（示例）","category":"APPROVAL","description":"d",
              "version":1,"status":"DRAFT","supportedFormCodes":["PUR_FORM"],
              "formSchema":null,"config":"{}",
              "nodes":[
                {"nodeCode":"start","nodeName":"提交申请","nodeType":"START","sortOrder":0,
                 "canvasX":-266.0,"canvasY":22.0,"conditionExpr":null,"assigneeRule":"{}",
                 "timeoutHours":null,"config":"{}"},
                {"nodeCode":"approve","nodeName":"主管审批","nodeType":"APPROVAL","sortOrder":1,
                 "canvasX":30.5,"canvasY":32.7,"conditionExpr":null,
                 "assigneeRule":"{\\"type\\": \\"SELF\\"}","timeoutHours":24,"config":"{}"},
                {"nodeCode":"end","nodeName":"归档","nodeType":"END","sortOrder":2,
                 "canvasX":-117.5,"canvasY":-70.0,"conditionExpr":null,"assigneeRule":"{}",
                 "timeoutHours":null,"config":"{}"}],
              "createdAt":null,"updatedAt":null,"categoryId":null}}""";

    private final AtomicReference<String> responseBody = new AtomicReference<>(DEFINITION_WITH_EDGES);

    private TaskflowWebClient client;

    @BeforeEach
    void setUp() {
        responseBody.set(DEFINITION_WITH_EDGES);

        WebClient.Builder recording = WebClient.builder().exchangeFunction(req ->
                Mono.just(ClientResponse.create(HttpStatus.OK)
                        .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                        .body(responseBody.get())
                        .build()));

        BffProperties properties = new BffProperties();
        properties.setTaskflowDiscoveryEnabled(false);
        properties.setTaskflowBaseUrl(BASE);
        properties.setAggregateTimeoutMs(5000);

        client = new TaskflowWebClient(recording, WebClient.builder(), properties);
    }

    @Test
    @DisplayName("定义详情的 edges 必须透传给前端（BFF 漏字段会导致编排页一条连线都没有）")
    void workflowDefinitionKeepsEdges() {
        WfDefinitionDTO def = client.workflowDefinition(950001L, 1L);

        assertNotNull(def, "定义详情不应为 null");
        assertNotNull(def.edges(),
                "BFF 的 WfDefinitionDTO 漏了 edges 分量 ⇒ 下游 wf_edge 被静默丢弃 ⇒ 编排页无连线。"
                        + "请把 edges 加回 record（配合 WfEdgeDTO）");
        assertEquals(2, def.edges().size(), "两条边都应原样透传");

        // source/target 必须是 nodeCode（start/approve），不是画布 id（n_start）——
        // 前端 toFlowEdge 会自己补n_ 前缀，这里若被污染就会渲染不出连线。
        assertEquals("start", def.edges().get(0).source());
        assertEquals("approve", def.edges().get(0).target());
        assertEquals("approve", def.edges().get(1).source());
        assertEquals("end", def.edges().get(1).target());
        assertEquals("DEFAULT", def.edges().get(0).edgeType());
        assertEquals(0, def.edges().get(0).sortOrder());
        assertEquals(1, def.edges().get(1).sortOrder());
    }

    @Test
    @DisplayName("nodes 仍需正常透传（同一record 的相邻分量，防修edges 时误伤 nodes）")
    void workflowDefinitionStillKeepsNodes() {
        WfDefinitionDTO def = client.workflowDefinition(950001L, 1L);

        assertNotNull(def.nodes());
        assertEquals(3, def.nodes().size());
        assertEquals(List.of("start", "approve", "end"),
                def.nodes().stream().map(n -> n.nodeCode()).toList());
    }

    @Test
    @DisplayName("老定义没有 edges 字段时按 null 处理，不抛异常（不能因缺字段 500）")
    void missingEdgesToleratedAsNull() {
        responseBody.set(DEFINITION_WITHOUT_EDGES);
        assertTrue(!DEFINITION_WITHOUT_EDGES.contains("\"edges\""),
                "本用例要求喂进去的 JSON 里确实没有 edges 分量");

        WfDefinitionDTO def = client.workflowDefinition(950001L, 1L);

        assertNotNull(def, "缺 edges 不能导致整个详情接口失败");
        assertEquals(3, def.nodes().size(), "nodes 仍应可用");
        assertTrue(def.edges() == null || def.edges().isEmpty(),
                "没有 edges 时返回 null/空数组均可，前端已用 (d.edges ?? []) 兜住");
    }

    /**
     * 根因固化：<b>按字段名</b>断言分量存在，而不是靠 {@code def.edges()} 的编译期引用。
     *
     * <p>这样写的意义：若有人再把 {@code edges} 从 record 里删掉，本用例<b>编译仍然通过</b>、
     * 运行时给出可读的失败信息（而不是像直接调 {@code def.edges()} 那样整份测试类编译失败、
     * 报错落在无关行号上让人摸不到头脑）。上面几条用例则负责钉住具体行为与取值。
     */
    @Test
    @DisplayName("根因固化：BFF DTO 必须声明 edges 分量（否则下游连线被静默丢弃）")
    void definitionDtoDeclaresEdgesComponent() {
        List<String> components = Arrays.stream(WfDefinitionDTO.class.getRecordComponents())
                .map(RecordComponent::getName)
                .toList();

        assertTrue(components.contains("edges"),
                () -> "WfDefinitionDTO 缺少 edges 分量。当前分量=" + components
                        + "；Spring Boot 默认 FAIL_ON_UNKNOWN_PROPERTIES=false，"
                        + "mis-taskflow 返回的 wf_edge 会被静默丢弃 ⇒ 编排页无连线且无任何报错");
        // 顺带钉住 nodes，避免修edges 时误删相邻分量。
        assertTrue(components.contains("nodes"), () -> "WfDefinitionDTO 缺少 nodes 分量：" + components);
    }
}