package com.mis.adminbff.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.adminbff.dto.kb.KbSynonymConfigVO;
import com.mis.adminbff.dto.kb.KbSynonymFileVO;
import com.mis.adminbff.dto.kb.KbSynonymGroupSaveRequest;
import com.mis.adminbff.dto.kb.KbSynonymGroupSnapshot;
import com.mis.adminbff.dto.kb.KbSynonymGroupVO;
import com.mis.adminbff.dto.kb.KbSynonymImportCommitVO;
import com.mis.adminbff.dto.kb.KbSynonymImportPrecheckVO;
import com.mis.adminbff.service.KbSynonymFacadeService;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.result.PageResult;
import com.mis.common.web.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.servlet.NoHandlerFoundException;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * {@link KbSynonymController} 的路由、透传与错误通道测试（Wave D / T10）。
 *
 * <p>用 {@code standaloneSetup} 而非 {@code @SpringBootTest}：本模块零 Spring 上下文测试
 * （起一次上下文要连 Nacos/Redis，沙箱不可达），而这里要验的三件事都不需要真实上下文——
 * 路由映射、参数绑定、异常到响应体的转换，都由 MockMvc 自己那套 handler mapping 完成。
 *
 * <p><b>为什么把真实的 {@link GlobalExceptionHandler} 挂上去</b>：
 * 40927 明细能否活到前端，取决于「Controller 不 catch」+「异常处理器写回 data」这两段的
 * <b>组合</b>。只断言门面抛了带 data 的异常，证明不了响应体里真有那三个字段——
 * 中间任何一段把它吃掉，测试仍然全绿。挂上真处理器才是端到端的证据。
 */
class KbSynonymControllerTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    /** 冲突码：词条已属于其它术语组（设计 §7.5）。 */
    private static final int KB_SYNONYM_TERM_CONFLICT = 40927;

    /** 计划过期码：预检之后词表被别人改过。 */
    private static final int KB_SYNONYM_IMPORT_STALE = 40930;

    private KbSynonymFacadeService facade;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        facade = mock(KbSynonymFacadeService.class);
        mockMvc = MockMvcBuilders.standaloneSetup(new KbSynonymController(facade))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    private static KbSynonymGroupVO group(long id, String canonical) {
        return new KbSynonymGroupVO(id, canonical, null, 1,
                List.of(new KbSynonymGroupVO.KbSynonymTermItemVO(canonical, true, 0)),
                1, null, null, null);
    }

    @Nested
    @DisplayName("路由：字面量段不被 {id} 抢走")
    class Routing {

        /**
         * 这一组是 T10 最容易出的一类错。{@code /config} 与 {@code /export} 和
         * {@code /{id}} 处在同一层级；若 {@code id} 不写正则约束，
         * 「GET /config 被当成 id=config」在<b>判权匹配</b>那一侧（AntPathMatcher，
         * 与 Spring 路由的字面量优先规则无关）依然可能发生。
         * 表现是配置读取被按「术语组详情」判权，或者反过来——都属于安静地判错权。
         */
        @Test
        @DisplayName("GET /config 命中 getConfig，不落到 getGroup")
        void configIsNotSwallowedById() throws Exception {
            when(facade.getConfig()).thenReturn(new KbSynonymConfigVO(
                    true, true, true, null, null, 7L));

            mockMvc.perform(get("/api/v1/kb/synonyms/config"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.dictVersion").value(7));

            verify(facade).getConfig();
            verify(facade, never()).getGroup(any());
        }

        @Test
        @DisplayName("GET /export 命中 export，不落到 getGroup")
        void exportIsNotSwallowedById() throws Exception {
            when(facade.export(isNull(), isNull(), isNull()))
                    .thenReturn(new KbSynonymFileVO("kb-synonyms.csv", "text/csv;charset=UTF-8", "\uFEFF序号,规范词\n"));

            mockMvc.perform(get("/api/v1/kb/synonyms/export"))
                    .andExpect(status().isOk());

            verify(facade).export(isNull(), isNull(), isNull());
            verify(facade, never()).getGroup(any());
        }

        @Test
        @DisplayName("GET /{id} 仍正常命中详情")
        void numericIdStillRoutesToDetail() throws Exception {
            when(facade.getGroup(42L)).thenReturn(group(42L, "关键结果法"));

            mockMvc.perform(get("/api/v1/kb/synonyms/42"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.id").value(42))
                    .andExpect(jsonPath("$.data.canonicalTerm").value("关键结果法"));
        }

        /**
         * 非数字段必须<b>无 handler 匹配</b>，绝不能被当成术语组 ID 发给下游。
         *
         * <p>断言写成「无 handler 匹配 + 门面零调用」而不是死盯 404：本轮实测发现，
         * 未匹配路径经 {@code GlobalExceptionHandler} 的
         * {@code @ExceptionHandler(Exception.class)} 兜底后落到 <b>500</b> 而非 404。
         * 那是全 BFF 共有的既有行为（不限于同义词），不在 T10 范围内；
         * 本用例要守的是路由层面的隔离，不该被那条兜底规则的取值绑架。
         */
        @Test
        @DisplayName("非数字 id 无 handler 匹配，不会被当成 id 发给下游")
        void nonNumericIdIsNotRouted() throws Exception {
            MvcResult result = mockMvc.perform(get("/api/v1/kb/synonyms/abc")).andReturn();

            int statusCode = result.getResponse().getStatus();
            Exception resolved = result.getResolvedException();
            assertTrue(
                    statusCode == 404 || resolved instanceof NoHandlerFoundException,
                    "期望无 handler 匹配，实际 status=" + statusCode + " resolved=" + resolved);
            verify(facade, never()).getGroup(any());
        }

        @Test
        @DisplayName("列表路径不带尾斜杠——必须与 sys_api 登记的 /api/v1/kb/synonyms 逐字一致")
        void listPathHasNoTrailingSlash() throws Exception {
            when(facade.listGroups(any(), any(), any(), any(), any()))
                    .thenReturn(PageResult.of(0, 20, 1, List.of(group(1L, "年假"))));

            mockMvc.perform(get("/api/v1/kb/synonyms"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.total").value(1))
                    .andExpect(jsonPath("$.data.list[0].canonicalTerm").value("年假"));
        }

        @Test
        @DisplayName("GET /import/{batchId}/rejected 命中未导入行下载")
        void rejectedRowsRoute() throws Exception {
            when(facade.rejectedRows(88L))
                    .thenReturn(new KbSynonymFileVO("rejected-88.csv", "text/csv;charset=UTF-8", "行号,原因\n"));

            mockMvc.perform(get("/api/v1/kb/synonyms/import/88/rejected"))
                    .andExpect(status().isOk());

            verify(facade).rejectedRows(88L);
        }
    }

    @Nested
    @DisplayName("查询参数原样透传")
    class QueryParamPassthrough {

        @Test
        @DisplayName("列表五个参数一个不落地传给门面")
        void listPassesAllParams() throws Exception {
            when(facade.listGroups(any(), any(), any(), any(), any()))
                    .thenReturn(PageResult.empty(1, 50));

            mockMvc.perform(get("/api/v1/kb/synonyms")
                            .param("keyword", "OKR")
                            .param("status", "1")
                            .param("page", "1")
                            .param("size", "50")
                            .param("sort", "id,desc"))
                    .andExpect(status().isOk());

            verify(facade).listGroups("OKR", 1, 1, 50, "id,desc");
        }

        @Test
        @DisplayName("导出三个过滤参数与列表同口径")
        void exportPassesFilters() throws Exception {
            when(facade.export(any(), any(), any()))
                    .thenReturn(new KbSynonymFileVO("x.json", "application/json;charset=UTF-8", "[]"));

            mockMvc.perform(get("/api/v1/kb/synonyms/export")
                            .param("keyword", "年假")
                            .param("status", "0")
                            .param("format", "JSON"))
                    .andExpect(status().isOk());

            verify(facade).export("年假", 0, "JSON");
        }
    }

    @Nested
    @DisplayName("⚠ 40927 冲突明细必须出现在响应体 data 里")
    class ConflictDetailReachesResponseBody {

        @Test
        @DisplayName("新建冲突：code=40927 且 data 三字段完整")
        void createConflictKeepsDetail() throws Exception {
            when(facade.createGroup(any())).thenThrow(new BusinessException(
                    KB_SYNONYM_TERM_CONFLICT,
                    "词条「OKR」已属于术语组「关键结果法」",
                    Map.of("term", "OKR", "ownerGroupId", 42L, "ownerCanonicalTerm", "关键结果法")));

            mockMvc.perform(post("/api/v1/kb/synonyms")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(MAPPER.writeValueAsBytes(new KbSynonymGroupSaveRequest(
                                    "目标管理", List.of("OKR"), null, 1))))
                    // Phase 1 约定：业务异常走 HTTP 200 + body.code
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(KB_SYNONYM_TERM_CONFLICT))
                    .andExpect(jsonPath("$.message").value("词条「OKR」已属于术语组「关键结果法」"))
                    .andExpect(jsonPath("$.data.term").value("OKR"))
                    .andExpect(jsonPath("$.data.ownerGroupId").value(42))
                    .andExpect(jsonPath("$.data.ownerCanonicalTerm").value("关键结果法"));
        }

        @Test
        @DisplayName("编辑冲突：term 保持全角原文，前端才能说破「全半角视为同一个词」")
        void updateConflictKeepsFullWidthTerm() throws Exception {
            when(facade.updateGroup(eq(9L), any())).thenThrow(new BusinessException(
                    KB_SYNONYM_TERM_CONFLICT,
                    "词条「ＯＫＲ」已属于术语组「关键结果法」",
                    Map.of("term", "ＯＫＲ", "ownerGroupId", 42L, "ownerCanonicalTerm", "关键结果法")));

            mockMvc.perform(put("/api/v1/kb/synonyms/9")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(MAPPER.writeValueAsBytes(new KbSynonymGroupSaveRequest(
                                    "目标管理", List.of("ＯＫＲ"), null, 1))))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(KB_SYNONYM_TERM_CONFLICT))
                    .andExpect(jsonPath("$.data.term").value("ＯＫＲ"));
        }

        @Test
        @DisplayName("导入提交 40930：同一条通道，前端据此退回二次预检")
        void staleImportCodeReachesFrontend() throws Exception {
            when(facade.commit(any())).thenThrow(new BusinessException(
                    KB_SYNONYM_IMPORT_STALE, "词表已变更，请重新预检", null));

            mockMvc.perform(post("/api/v1/kb/synonyms/import/commit")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"token\":\"tk-1\",\"mergeExisting\":true}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(KB_SYNONYM_IMPORT_STALE))
                    .andExpect(jsonPath("$.data").doesNotExist());
        }
    }

    @Nested
    @DisplayName("删除：先取快照再删，快照进得了审计入参")
    class DeleteSnapshot {

        @Test
        @DisplayName("调用顺序是 loadDeleteSnapshot → deleteGroup(id, snapshot)")
        void snapshotIsTakenBeforeDelete() throws Exception {
            KbSynonymGroupSnapshot snapshot = new KbSynonymGroupSnapshot(
                    42L, "关键结果法", 1, "季度目标相关", List.of("关键结果法", "OKR", "ＯＫＲ"));
            when(facade.loadDeleteSnapshot(42L)).thenReturn(snapshot);

            mockMvc.perform(delete("/api/v1/kb/synonyms/42"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));

            InOrder order = inOrder(facade);
            order.verify(facade).loadDeleteSnapshot(42L);
            order.verify(facade).deleteGroup(eq(42L), eq(snapshot));
            verifyNoMoreInteractions(facade);
        }

        @Test
        @DisplayName("快照取不到（组不存在）时不发删除请求")
        void missingGroupAbortsDelete() throws Exception {
            when(facade.loadDeleteSnapshot(404L))
                    .thenThrow(new BusinessException(40415, "术语组不存在"));

            mockMvc.perform(delete("/api/v1/kb/synonyms/404"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(40415));

            verify(facade, never()).deleteGroup(any(), any());
        }

        /**
         * 硬删可追溯的<b>真实</b>验收点：快照必须能被 {@code OperLogAspect} 那个
         * <b>裸 {@code new ObjectMapper()}</b> 序列化。裸实例没注册 JavaTimeModule，
         * 任何 {@code java.time} 字段都会让切面的 {@code collectParams} 抛异常并
         * <b>整条返回 null</b>——不是少记一个时间，是整条 {@code request_params} 变空。
         * 这也正是不能把 {@link KbSynonymGroupVO}（含 {@code Instant updatedAt}）
         * 直接交给审计的原因。
         */
        @Test
        @DisplayName("快照能被审计切面的裸 ObjectMapper 序列化，且词条原文与顺序完整")
        void snapshotIsSerializableByBareMapper() throws Exception {
            KbSynonymGroupSnapshot snapshot = KbSynonymGroupSnapshot.from(42L,
                    new KbSynonymGroupVO(42L, "关键结果法", "季度目标相关", 1,
                            List.of(
                                    new KbSynonymGroupVO.KbSynonymTermItemVO("关键结果法", true, 0),
                                    new KbSynonymGroupVO.KbSynonymTermItemVO("OKR", false, 1),
                                    new KbSynonymGroupVO.KbSynonymTermItemVO("ＯＫＲ", false, 2)),
                            3, null, java.time.Instant.now(), 1L));

            String json = new ObjectMapper().writeValueAsString(snapshot);

            assertTrue(json.contains("\"canonicalTerm\":\"关键结果法\""), json);
            assertTrue(json.contains("\"remark\":\"季度目标相关\""), json);
            // 顺序即语义：审计里读到的必须和删除时一模一样
            assertEquals(List.of("关键结果法", "OKR", "ＯＫＲ"), snapshot.terms());

            // 反证：同一个裸 mapper 序列化含 Instant 的 VO 会直接抛异常
            org.junit.jupiter.api.Assertions.assertThrows(Exception.class,
                    () -> new ObjectMapper().writeValueAsString(
                            new KbSynonymGroupVO(1L, "x", null, 1, List.of(), 0, null,
                                    java.time.Instant.now(), 1L)));
        }

        @Test
        @DisplayName("下游详情为空时退化成只有 id 的残缺快照，不让删除本身失败")
        void nullDetailDegradesGracefully() {
            KbSynonymGroupSnapshot snapshot = KbSynonymGroupSnapshot.from(7L, null);

            assertEquals(7L, snapshot.id());
            assertEquals(List.of(), snapshot.terms());
        }
    }

    @Nested
    @DisplayName("导入 / 导出的 HTTP 形态")
    class ImportExportShape {

        @Test
        @DisplayName("导出直吐字节流，Content-Disposition 同时给 filename 与 filename*")
        void exportWritesDownloadHeaders() throws Exception {
            String csv = "\uFEFF序号,规范词,别名\n1,关键结果法,OKR|ＯＫＲ\n";
            when(facade.export(any(), any(), any()))
                    .thenReturn(new KbSynonymFileVO("同义词表.csv", "text/csv;charset=UTF-8", csv));

            byte[] body = mockMvc.perform(get("/api/v1/kb/synonyms/export"))
                    .andExpect(status().isOk())
                    .andExpect(header().string(HttpHeaders.CONTENT_DISPOSITION,
                            org.hamcrest.Matchers.containsString("filename*=UTF-8''")))
                    .andExpect(content().contentTypeCompatibleWith("text/csv"))
                    .andReturn().getResponse().getContentAsByteArray();

            // 下游给的已是成品文本（含 BOM），这一层不得再加一次
            assertEquals(csv, new String(body, StandardCharsets.UTF_8));
            assertEquals(1, new String(body, StandardCharsets.UTF_8).chars()
                    .filter(ch -> ch == '\uFEFF').count(), "BOM 只能有一个");
        }

        @Test
        @DisplayName("预检 multipart 原样交给门面，BFF 不解析文件内容")
        void precheckForwardsMultipart() throws Exception {
            when(facade.precheck(any())).thenReturn(new KbSynonymImportPrecheckVO(
                    "tk-1", 5L, "CSV", 3, 1, 1, List.of(), List.of(), null));

            MockMultipartFile file = new MockMultipartFile(
                    "file", "同义词.csv", "text/csv",
                    "序号,规范词,别名\n".getBytes(StandardCharsets.UTF_8));

            mockMvc.perform(multipart("/api/v1/kb/synonyms/import/precheck").file(file))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.token").value("tk-1"));

            ArgumentCaptor<org.springframework.web.multipart.MultipartFile> captor =
                    ArgumentCaptor.forClass(org.springframework.web.multipart.MultipartFile.class);
            verify(facade).precheck(captor.capture());
            assertEquals("同义词.csv", captor.getValue().getOriginalFilename(),
                    "原始文件名必须原样带下去——下游按扩展名嗅探格式");
        }

        @Test
        @DisplayName("提交返回执行计数")
        void commitReturnsCounts() throws Exception {
            when(facade.commit(any())).thenReturn(new KbSynonymImportCommitVO(5L, 3, 1, 1));

            mockMvc.perform(post("/api/v1/kb/synonyms/import/commit")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"token\":\"tk-1\",\"mergeExisting\":false}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.createdCount").value(3))
                    .andExpect(jsonPath("$.data.mergedCount").value(1))
                    .andExpect(jsonPath("$.data.skippedCount").value(1));
        }
    }
}
