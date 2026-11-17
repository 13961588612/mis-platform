package com.mis.recon.service.pull;

import com.mis.recon.common.BizException;
import com.mis.recon.custom.CustomFetcher;
import com.mis.recon.custom.FetchContext;
import com.mis.recon.custom.example.CsvDirFetcher;
import com.mis.recon.dao.LedgerDao;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.domain.dto.ProbeResp;
import com.mis.recon.repository.ConnectionRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.service.engine.CustomLoader;
import com.mis.recon.service.engine.ReadinessGateEvaluator;
import com.mis.recon.service.ledger.HealthEvaluator;
import com.mis.recon.service.ledger.LedgerService;
import com.mis.recon.service.ledger.SeqWatermarkService;
import com.mis.recon.service.support.ConnectionPoolManager;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.transaction.PlatformTransactionManager;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Timestamp;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * PullRunner 取数层集成测试（第四批 P 组 api/custom 集成，取数层需求规格 §7）。
 * <p>api：全链路拉取 → 台账 upsert / 试拉 / fetch_one；custom：CustomFetcher 窗口拉取 → 台账 upsert /
 * 试拉 / fetch_one 不支持。源端用 JDK HttpServer mock；下游全部 mock。</p>
 */
class PullRunnerFetchTest {

    private DatasourceRepository datasourceRepository;
    private LedgerService ledgerService;
    private SeqWatermarkService seqWatermarkService;
    private PullRunDao pullRunDao;
    private HealthEvaluator healthEvaluator;
    private PlatformTransactionManager txManager;
    private ReadinessGateEvaluator readinessGateEvaluator;
    private CustomLoader customLoader;
    private PullRunner pullRunner;

    private HttpServer server;
    private int port;
    private volatile String responseBody = "[]";

    @BeforeEach
    void setUp() throws IOException {
        datasourceRepository = mock(DatasourceRepository.class);
        ConnectionRepository connectionRepository = mock(ConnectionRepository.class);
        ConnectionPoolManager connectionPoolManager = mock(ConnectionPoolManager.class);
        ledgerService = mock(LedgerService.class);
        seqWatermarkService = mock(SeqWatermarkService.class);
        pullRunDao = mock(PullRunDao.class);
        healthEvaluator = mock(HealthEvaluator.class);
        txManager = mock(PlatformTransactionManager.class);
        readinessGateEvaluator = mock(ReadinessGateEvaluator.class);
        customLoader = mock(CustomLoader.class);
        pullRunner = new PullRunner(datasourceRepository, connectionRepository, connectionPoolManager,
                ledgerService, seqWatermarkService, pullRunDao, healthEvaluator, txManager,
                readinessGateEvaluator, customLoader);

        when(ledgerService.resolveAmountSpec(any())).thenReturn(new LedgerDao.AmountSpec());
        when(readinessGateEvaluator.evaluateForDs(anyString(), anyLong()))
                .thenReturn(new ReadinessGateEvaluator.Evaluation(ReadinessGateEvaluator.GateResult.PASS, "{}"));
        when(pullRunDao.findLastSuccessWindowEnd(anyString())).thenReturn(null);
        when(pullRunDao.start(anyString(), any(), any())).thenReturn(1L);
        when(pullRunDao.findLastSuccessRowCount(anyString())).thenReturn(null);
        when(healthEvaluator.eval(any(), anyInt(), any(), any()))
                .thenReturn(new HealthEvaluator.HealthResult("healthy", "{}"));
        // TransactionTemplate.execute 内部：getTransaction → callback → commit；mock 事务状态即可跑通
        when(txManager.getTransaction(any())).thenReturn(mock(org.springframework.transaction.TransactionStatus.class));

        server = HttpServer.create(new InetSocketAddress(0), 0);
        server.createContext("/bills", this::handleBills);
        server.createContext("/bills-one", this::handleOne);
        server.start();
        port = server.getAddress().getPort();
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    private void handleBills(HttpExchange ex) throws IOException {
        respond(ex, responseBody);
    }

    private void handleOne(HttpExchange ex) throws IOException {
        respond(ex, responseBody);
    }

    private void respond(HttpExchange ex, String body) throws IOException {
        byte[] b = body.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(200, b.length);
        try (OutputStream os = ex.getResponseBody()) {
            os.write(b);
        }
    }

    private ReconDatasource apiDs(String cfg) {
        ReconDatasource ds = new ReconDatasource();
        ds.setDsCode("api1");
        ds.setName("接口数据源");
        ds.setFetchType("api");
        ds.setFetchConfigJson(cfg);
        ds.setRecordKeyExpression("{order_no}");
        ds.setEnabled(1);
        return ds;
    }

    private ReconDatasource customDs() {
        ReconDatasource ds = new ReconDatasource();
        ds.setDsCode("cust1");
        ds.setName("自定义数据源");
        ds.setFetchType("custom");
        ds.setFetchConfigJson("{\"class\":\"com.mis.recon.service.pull.TestStaticFetcher\","
                + "\"config_json\":{\"path\":\"/data\"}}");
        ds.setRecordKeyExpression("{order_no}");
        ds.setEnabled(1);
        return ds;
    }

    private String apiCfg(String extra) {
        return "{\"url\":\"http://localhost:" + port + "/bills?start={time_start}&end={time_end}\","
                + "\"method\":\"GET\","
                + "\"page\":{\"mode\":\"page_no\",\"size\":500},"
                + "\"data_path\":\"$.data.list\""
                + (extra == null || extra.isBlank() ? "" : "," + extra) + "}";
    }

    private LedgerDao.BatchResult batchResult(int n) {
        LedgerDao.BatchResult r = new LedgerDao.BatchResult();
        r.insertCount = n;
        r.updateCount = 0;
        r.maxSeq = n;
        return r;
    }

    // ==================== api 集成 ====================

    @Test
    void apiRunUpsertsToLedger() {
        // P-9：api 全链路（配置解析 → HTTP 拉取 → fields_json 映射 → 台账 upsert）
        responseBody = "{\"data\":{\"list\":[{\"order_no\":\"A1\",\"pay_amount\":\"100\"},{\"order_no\":\"A2\",\"pay_amount\":\"200\"}]}}";
        ReconDatasource ds = apiDs(apiCfg(null));
        when(datasourceRepository.findByDsCode("api1")).thenReturn(Optional.of(ds));
        when(ledgerService.upsertRows(eq("api1"), any(), any(), anyLong(), any(), any()))
                .thenReturn(batchResult(2));

        pullRunner.run("api1");

        ArgumentCaptor<List<Map<String, Object>>> rowsCaptor = ArgumentCaptor.forClass(List.class);
        verify(ledgerService).upsertRows(eq("api1"), eq("{order_no}"), rowsCaptor.capture(), eq(1L), any(), any());
        assertEquals(2, rowsCaptor.getValue().size());
        assertEquals("A1", rowsCaptor.getValue().get(0).get("order_no"));
        verify(pullRunDao).finishSuccess(eq(1L), any(), any(), eq(2), eq(2), eq(0), any());
    }

    @Test
    void apiProbeReturnsSample() {
        // P-10：api 试拉（小窗口拉取返回样例 + 字段数）
        responseBody = "{\"data\":{\"list\":[{\"order_no\":\"A1\",\"pay_amount\":\"100\"}]}}";
        ReconDatasource ds = apiDs(apiCfg(null));
        when(datasourceRepository.findByDsCode("api1")).thenReturn(Optional.of(ds));

        ProbeResp resp = pullRunner.probe("api1");

        assertTrue(resp.isConnected());
        assertEquals("A1", resp.getSampleRow().get("order_no"));
    }

    @Test
    void apiFetchOneUpserts() {
        // P-11：api fetch_one（fetch_one_url + {record_key} → 单条 upsert）
        responseBody = "{\"data\":{\"list\":[{\"order_no\":\"X1\",\"pay_amount\":\"88\"}]}}";
        String cfg = apiCfg("\"fetch_one_url\":\"http://localhost:" + port
                + "/bills-one?key={record_key}\"");
        ReconDatasource ds = apiDs(cfg);
        when(datasourceRepository.findByDsCode("api1")).thenReturn(Optional.of(ds));
        when(ledgerService.upsertOne(eq("api1"), any(), any(), anyLong(), any(), any()))
                .thenReturn(batchResult(1));

        Map<String, Object> resp = pullRunner.fetchOne("api1", "X1");

        assertEquals(true, resp.get("found"));
        verify(ledgerService).upsertOne(eq("api1"), eq("{order_no}"), any(), eq(0L), any(), any());
    }

    // ==================== custom 集成 ====================

    @Test
    void customRunUpsertsToLedger() {
        // P-12：custom 全链路（CustomFetcher 按窗口拉取 → 台账 upsert；config_json 参数透传）
        ReconDatasource ds = customDs();
        when(datasourceRepository.findByDsCode("cust1")).thenReturn(Optional.of(ds));
        when(customLoader.load("com.mis.recon.service.pull.TestStaticFetcher", CustomFetcher.class))
                .thenReturn(new TestStaticFetcher());
        when(ledgerService.upsertRows(eq("cust1"), any(), any(), anyLong(), any(), any()))
                .thenReturn(batchResult(1));

        pullRunner.run("cust1");

        ArgumentCaptor<List<Map<String, Object>>> rowsCaptor = ArgumentCaptor.forClass(List.class);
        verify(ledgerService).upsertRows(eq("cust1"), eq("{order_no}"), rowsCaptor.capture(), eq(1L), any(), any());
        assertEquals(1, rowsCaptor.getValue().size());
        assertEquals("C1", rowsCaptor.getValue().get(0).get("order_no"));
        // 窗口入参 + config_json 透传
        ArgumentCaptor<FetchContext> ctxCaptor = ArgumentCaptor.forClass(FetchContext.class);
        verify(customLoader).load("com.mis.recon.service.pull.TestStaticFetcher", CustomFetcher.class);
        verify(pullRunDao).finishSuccess(eq(1L), any(), any(), eq(1), eq(1), eq(0), any());
        assertTrue(TestStaticFetcher.LAST_CTX.getWindowStart() != null);
        assertTrue(TestStaticFetcher.LAST_CTX.getWindowEnd() != null);
        assertEquals("/data", TestStaticFetcher.LAST_CTX.getParams().get("path"));
    }

    @Test
    void customProbeReturnsSample() {
        // P-13：custom 试拉
        ReconDatasource ds = customDs();
        when(datasourceRepository.findByDsCode("cust1")).thenReturn(Optional.of(ds));
        when(customLoader.load("com.mis.recon.service.pull.TestStaticFetcher", CustomFetcher.class))
                .thenReturn(new TestStaticFetcher());

        ProbeResp resp = pullRunner.probe("cust1");

        assertTrue(resp.isConnected());
        assertEquals("C1", resp.getSampleRow().get("order_no"));
    }

    @Test
    void customFetchOneUnsupported() {
        // P-14：custom fetch_one 默认不支持（走 backfill，§4.5/R11）
        ReconDatasource ds = customDs();
        when(datasourceRepository.findByDsCode("cust1")).thenReturn(Optional.of(ds));
        when(customLoader.load("com.mis.recon.service.pull.TestStaticFetcher", CustomFetcher.class))
                .thenReturn(new TestStaticFetcher());

        BizException ex = assertThrows(BizException.class, () -> pullRunner.fetchOne("cust1", "C1"));
        assertEquals(7005, ex.getCode());
    }

    @Test
    void customRunWithCsvDirFetcherEndToEnd() throws Exception {
        // P-15：前端「内置示例 CsvDirFetcher」配置 → 后端全链路（临时目录 CSV → 窗口圈定 → 台账 upsert）
        Path dir = Files.createTempDirectory("bills");
        Files.writeString(dir.resolve("bill_20260826.csv"),
                "order_no,pay_amount,biz_date\nC1,66,20260826\n");
        ReconDatasource ds = customDs();
        ds.setFetchConfigJson("{\"class\":\"com.mis.recon.custom.example.CsvDirFetcher\","
                + "\"config_json\":{\"dir\":\"" + dir.toString().replace("\\", "\\\\") + "\"}}");
        when(datasourceRepository.findByDsCode("cust1")).thenReturn(Optional.of(ds));
        when(customLoader.load("com.mis.recon.custom.example.CsvDirFetcher", CustomFetcher.class))
                .thenReturn(new CsvDirFetcher());
        when(ledgerService.upsertRows(eq("cust1"), any(), any(), anyLong(), any(), any()))
                .thenReturn(batchResult(1));

        // 窗口 [08-26, 08-27)：文件 bill_20260826.csv 命中
        pullRunner.run("cust1", LocalDateTime.of(2026, 8, 26, 0, 0), LocalDateTime.of(2026, 8, 27, 0, 0));

        ArgumentCaptor<List<Map<String, Object>>> rowsCaptor = ArgumentCaptor.forClass(List.class);
        verify(ledgerService).upsertRows(eq("cust1"), eq("{order_no}"), rowsCaptor.capture(), eq(1L), any(), any());
        assertEquals(1, rowsCaptor.getValue().size());
        assertEquals("C1", rowsCaptor.getValue().get(0).get("order_no"));
        // time_field 已按 CsvDirFetcher 语义转 Timestamp（当天 00:00）
        assertEquals(LocalDateTime.of(2026, 8, 26, 0, 0),
                ((Timestamp) rowsCaptor.getValue().get(0).get("biz_date")).toLocalDateTime());
    }
}

/** 测试用 CustomFetcher 实现（public + 无参构造，反射/类加载可命中；供 FetchValidationTest 复用）。 */
class TestStaticFetcher implements CustomFetcher {

    static volatile FetchContext LAST_CTX;

    public TestStaticFetcher() {
    }

    @Override
    public List<Map<String, Object>> fetch(FetchContext ctx) {
        LAST_CTX = ctx;
        return List.of(Map.of("order_no", "C1", "pay_amount", "66"));
    }
}
