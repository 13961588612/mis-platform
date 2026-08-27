package com.mis.adminbff.client;

import com.mis.adminbff.client.model.DeptStaffingVO;
import com.mis.adminbff.client.model.PostVO;
import com.mis.adminbff.config.BffProperties;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.client.WebClient;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * BFF → mis-org 契约测试：部门编制路由 + 岗位多选查询参数序列化。
 *
 * <p>用本地 {@link HttpServer} 充当假 mis-org，断言 {@code OrgWebClient} 真实发出的
 * 请求行（path + 原始查询串），以及响应体的 Jackson 反序列化字段对齐。守的契约：
 * <ol>
 *   <li><b>路径拼装</b>——{@code getDeptStaffing} 必须打到
 *       {@code /internal/v1/depts/{id}/staffing}（id 进 path 而非查询串）；</li>
 *   <li><b>tenantId 注入</b>——由 BFF 侧作为查询参数下传，前端不感知；</li>
 *   <li><b>多选序列化</b>——{@code deptIds}/{@code orgIds} 以<b>逗号串</b>下传；
 *       {@code null}/空 List 一律不出现在查询串（「没传」≠「传了空值」）；</li>
 *   <li><b>字段对齐</b>——BFF POJO 与 mis-org 真实字段一致（{@code postType} /
 *       {@code isPrimary}），架构文档写的 {@code postTypeName}/{@code avatar}
 *       为文档笔误，反序列化时须能安全忽略未知字段而不抛异常。</li>
 * </ol>
 */
class OrgWebClientStaffingAndPostQueryTest {

    private HttpServer server;
    private final AtomicReference<String> rawPath = new AtomicReference<>();
    private final AtomicReference<String> rawQuery = new AtomicReference<>();
    private final AtomicReference<String> responseBody = new AtomicReference<>();
    private OrgWebClient client;

    @BeforeEach
    void setUp() throws IOException {
        rawPath.set(null);
        rawQuery.set(null);
        responseBody.set("{\"code\":0,\"message\":\"ok\",\"data\":null}");

        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            rawPath.set(exchange.getRequestURI().getRawPath());
            rawQuery.set(exchange.getRequestURI().getRawQuery());
            byte[] body = responseBody.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", MediaType.APPLICATION_JSON_VALUE);
            exchange.sendResponseHeaders(200, body.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(body);
            }
        });
        server.start();

        BffProperties properties = new BffProperties();
        properties.setOrgDiscoveryEnabled(false);
        properties.setOrgBaseUrl("http://127.0.0.1:" + server.getAddress().getPort());
        properties.setAggregateTimeoutMs(5000);
        client = new OrgWebClient(WebClient.builder(), WebClient.builder(), properties);
    }

    @AfterEach
    void tearDown() {
        if (server != null) {
            server.stop(0);
        }
    }

    /** 取查询串中某参数的解码值；不存在返回 null。 */
    private String param(String name) {
        String query = rawQuery.get();
        if (query == null) {
            return null;
        }
        for (String pair : query.split("&")) {
            String[] kv = pair.split("=", 2);
            if (kv[0].equals(name)) {
                return kv.length > 1 ? URLDecoder.decode(kv[1], StandardCharsets.UTF_8) : "";
            }
        }
        return null;
    }

    // ------------------------------------------------------------ 编制路由

    @Nested
    @DisplayName("GET /internal/v1/depts/{id}/staffing：路径拼装 + tenantId 注入")
    class DeptStaffingRoute {

        @Test
        @DisplayName("deptId 进 path、tenantId 进查询串")
        void assemblesPathAndInjectsTenantId() {
            responseBody.set("""
                    {"code":0,"message":"ok","data":{
                      "deptId":"77","deptName":"研发中心",
                      "postCount":2,"filledCount":1,"vacantCount":1,
                      "posts":[],"employees":[]}}
                    """);

            DeptStaffingVO vo = client.getDeptStaffing(77L, 1L);

            assertEquals("/internal/v1/depts/77/staffing", rawPath.get(),
                    () -> "路径必须把 deptId 拼进 path，实际：" + rawPath.get());
            assertEquals("1", param("tenantId"), "tenantId 必须由 BFF 注入下传");
            assertNotNull(vo);
            assertEquals("77", vo.deptId());
            assertEquals(2, vo.postCount());
            assertEquals(1, vo.filledCount());
            assertEquals(1, vo.vacantCount());
        }

        @Test
        @DisplayName("Q1/Q8 口径：vacantCount = postCount − filledCount 原样透传，BFF 不重算")
        void passesThroughStaffingCounts() {
            responseBody.set("""
                    {"code":0,"message":"ok","data":{
                      "deptId":"88","deptName":"市场部",
                      "postCount":5,"filledCount":2,"vacantCount":3,
                      "posts":[],"employees":[]}}
                    """);

            DeptStaffingVO vo = client.getDeptStaffing(88L, 1L);

            assertEquals(5, vo.postCount());
            assertEquals(2, vo.filledCount());
            assertEquals(3, vo.vacantCount());
            assertEquals(vo.postCount() - vo.filledCount(), vo.vacantCount(),
                    "缺编数口径应为 岗位数 − 任职数（后端计算，BFF 透传）");
        }
    }

    // ------------------------------------------------------------ 字段对齐

    @Nested
    @DisplayName("字段对齐复核：真实字段 postType / isPrimary（架构文档笔误不应影响运行）")
    class FieldAlignment {

        @Test
        @DisplayName("真实字段 postType + isPrimary 正确反序列化")
        void deserializesRealFieldNames() {
            responseBody.set("""
                    {"code":0,"message":"ok","data":{
                      "deptId":"77","deptName":"研发中心",
                      "postCount":1,"filledCount":1,"vacantCount":0,
                      "posts":[{"postId":"11","postName":"研发工程师","postType":"技术",
                                "holders":[{"id":"5","name":"王磊","isPrimary":1}],"vacant":false}],
                      "employees":[{"id":"5","name":"王磊","isPrimary":1}]}}
                    """);

            DeptStaffingVO vo = client.getDeptStaffing(77L, 1L);

            assertEquals(1, vo.posts().size());
            assertEquals("技术", vo.posts().get(0).postType(),
                    "岗位类型字段名为 postType（非架构图写的 postTypeName）");
            assertFalse(vo.posts().get(0).vacant());
            assertEquals("王磊", vo.posts().get(0).holders().get(0).name());
            assertEquals(1, vo.employees().get(0).isPrimary(),
                    "员工轻量视图第三字段为 isPrimary（非架构图写的 avatar）");
        }

        @Test
        @DisplayName("下游多传架构图里的 postTypeName / avatar → 安全忽略，不抛异常")
        void unknownFieldsAreIgnored() {
            responseBody.set("""
                    {"code":0,"message":"ok","data":{
                      "deptId":"77","deptName":"研发中心",
                      "postCount":1,"filledCount":0,"vacantCount":1,
                      "posts":[{"postId":"11","postName":"研发工程师","postTypeName":"技术",
                                "holders":[],"vacant":true}],
                      "employees":[{"id":"5","name":"王磊","avatar":"http://x/a.png"}]}}
                    """);

            DeptStaffingVO vo = client.getDeptStaffing(77L, 1L);

            assertNotNull(vo, "未知字段必须被忽略而非导致反序列化失败");
            assertNull(vo.posts().get(0).postType(),
                    "文档字段 postTypeName 不会填充 postType —— 证明以代码字段为准是正确的");
            assertTrue(vo.posts().get(0).vacant());
            assertNull(vo.employees().get(0).isPrimary());
        }
    }

    // ------------------------------------------------------------ 多选序列化

    @Nested
    @DisplayName("GET /internal/v1/posts：deptIds / orgIds 逗号串序列化")
    class PostQuerySerialization {

        @BeforeEach
        void emptyList() {
            responseBody.set("{\"code\":0,\"message\":\"ok\",\"data\":[]}");
        }

        @Test
        @DisplayName("deptIds=[1,2] + orgIds=[3,4] → deptIds=1,2 & orgIds=3,4")
        void serializesBothAsCommaLists() {
            List<PostVO> result = client.listPosts(1L, null, List.of(1L, 2L), null, null, List.of(3L, 4L));

            assertNotNull(result);
            assertEquals("/internal/v1/posts", rawPath.get());
            assertEquals("1", param("tenantId"));
            assertEquals("1,2", param("deptIds"), () -> "实际查询串：" + rawQuery.get());
            assertEquals("3,4", param("orgIds"), () -> "实际查询串：" + rawQuery.get());
        }

        @Test
        @DisplayName("单元素列表 → 无尾随逗号")
        void singleElementHasNoTrailingComma() {
            client.listPosts(1L, null, List.of(9L), null, null, null);

            assertEquals("9", param("deptIds"));
            assertNull(param("orgIds"), "未传 orgIds 不应出现在查询串");
        }

        @Test
        @DisplayName("null 与空 List → 参数完全不出现（「没传」≠「传了空值」）")
        void nullAndEmptyListsOmitted() {
            client.listPosts(1L, null, List.of(), null, null, List.of());

            assertNull(param("deptIds"), () -> "空 List 不应下传，实际查询串：" + rawQuery.get());
            assertNull(param("orgIds"), () -> "空 List 不应下传，实际查询串：" + rawQuery.get());
            assertEquals("tenantId=1", rawQuery.get(), "只应保留 tenantId");
        }

        @Test
        @DisplayName("单值 deptId 与多值 deptIds 可共存（兼容语义在后端合并）")
        void singleDeptIdCoexistsWithDeptIds() {
            client.listPosts(1L, 5L, List.of(1L, 2L), null, null, null);

            assertEquals("5", param("deptId"));
            assertEquals("1,2", param("deptIds"));
        }

        @Test
        @DisplayName("postTypeId / status 与多选参数同时下传，互不干扰")
        void coexistsWithLegacyParams() {
            client.listPosts(1L, null, List.of(1L), 7L, 1, List.of(3L));

            assertEquals("1", param("deptIds"));
            assertEquals("3", param("orgIds"));
            assertEquals("7", param("postTypeId"));
            assertEquals("1", param("status"));
        }

        @Test
        @DisplayName("查询串不得出现二次编码指纹 %25")
        void noDoubleEncoding() {
            client.listPosts(1L, null, List.of(1L, 2L), null, null, List.of(3L, 4L));

            assertFalse(rawQuery.get().contains("%25"),
                    () -> "出现 %25 = 二次编码回归：" + rawQuery.get());
        }
    }
}
