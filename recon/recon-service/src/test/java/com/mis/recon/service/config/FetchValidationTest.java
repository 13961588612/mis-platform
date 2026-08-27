package com.mis.recon.service.config;

import com.mis.recon.common.BizException;
import com.mis.recon.domain.dto.DatasourceSaveReq;
import com.mis.recon.repository.ConnectionRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.repository.ScenarioRepository;
import com.mis.recon.service.engine.CustomLoader;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.context.ApplicationContext;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * 取数层保存校验（第四批 P 组 api/custom 集成：取数层需求规格 §3.8 / §4.6）。
 * <p>api：url 必填 / 窗口占位符 / method 白名单 / cursor 参数 / page_no size / conn_code 置空；
 * custom：class 必填 / 类可加载 / 实现 CustomFetcher / config_json 对象 / conn_code 置空。
 * CustomLoader 用真实实现（mock ApplicationContext），类加载与接口校验走真实逻辑。</p>
 */
class FetchValidationTest {

    private ConfigValidationService service;

    @BeforeEach
    void setUp() {
        ConnectionRepository connRepo = Mockito.mock(ConnectionRepository.class);
        DatasourceRepository dsRepo = Mockito.mock(DatasourceRepository.class);
        ScenarioRepository scenarioRepo = Mockito.mock(ScenarioRepository.class);
        CustomLoader realLoader = new CustomLoader(Mockito.mock(ApplicationContext.class));
        service = new ConfigValidationService(connRepo, dsRepo, scenarioRepo, realLoader);
    }

    private DatasourceSaveReq apiDs(String cfg) {
        DatasourceSaveReq req = new DatasourceSaveReq();
        req.setDsCode("api1");
        req.setName("接口数据源");
        req.setRecordKeyExpression("{order_no}");
        req.setFetchType("api");
        req.setFetchConfigJson(cfg);
        return req;
    }

    private DatasourceSaveReq customDs(String cfg) {
        DatasourceSaveReq req = new DatasourceSaveReq();
        req.setDsCode("cust1");
        req.setName("自定义数据源");
        req.setRecordKeyExpression("{order_no}");
        req.setFetchType("custom");
        req.setFetchConfigJson(cfg);
        return req;
    }

    // ==================== api（§3.8） ====================

    @Test
    void apiUrlMissingRejected() {
        assertCode(6218, () -> service.validateDatasource(apiDs("{}")));
    }

    @Test
    void apiUrlWithoutWindowPlaceholdersRejected() {
        assertCode(6218, () -> service.validateDatasource(apiDs(
                "{\"url\":\"https://gw/bills\",\"method\":\"GET\"}")));
    }

    @Test
    void apiMethodInvalidRejected() {
        assertCode(6218, () -> service.validateDatasource(apiDs(
                "{\"url\":\"https://gw/bills?start={time_start}&end={time_end}\",\"method\":\"DELETE\"}")));
    }

    @Test
    void apiCursorModeMissingParamsRejected() {
        assertCode(6218, () -> service.validateDatasource(apiDs(
                "{\"url\":\"https://gw/bills?start={time_start}&end={time_end}\","
                        + "\"method\":\"GET\",\"page\":{\"mode\":\"cursor\",\"size\":500}}")));
    }

    @Test
    void apiPageNoSizeInvalidRejected() {
        assertCode(6218, () -> service.validateDatasource(apiDs(
                "{\"url\":\"https://gw/bills?start={time_start}&end={time_end}\","
                        + "\"method\":\"GET\",\"page\":{\"mode\":\"page_no\",\"size\":0}}")));
    }

    @Test
    void apiConnCodeSetRejected() {
        DatasourceSaveReq req = apiDs("{\"url\":\"https://gw/bills?start={time_start}&end={time_end}\",\"method\":\"GET\"}");
        req.setConnCode("mysql_x");
        assertCode(1001, () -> service.validateDatasource(req));
    }

    @Test
    void apiValidConfigPasses() {
        DatasourceSaveReq req = apiDs(
                "{\"url\":\"https://gw/bills?start={time_start}&end={time_end}\","
                        + "\"method\":\"GET\","
                        + "\"headers\":{\"Authorization\":\"Bearer ${TOKEN}\"},"
                        + "\"page\":{\"mode\":\"cursor\",\"cursor_param\":\"cursor\",\"cursor_path\":\"$.data.next_cursor\",\"size\":500},"
                        + "\"data_path\":\"$.data.list\","
                        + "\"retry\":{\"max\":3,\"backoff_ms\":2000},\"rate_limit_qps\":5}");
        assertDoesNotThrow(() -> service.validateDatasource(req));
    }

    // ==================== custom（§4.6） ====================

    @Test
    void customClassMissingRejected() {
        assertCode(6214, () -> service.validateDatasource(customDs("{}")));
    }

    @Test
    void customClassNotFoundRejected() {
        assertCode(6215, () -> service.validateDatasource(customDs(
                "{\"class\":\"com.no.such.MyFetcher\",\"config_json\":{\"path\":\"/data\"}}")));
    }

    @Test
    void customClassNotFetcherRejected() {
        assertCode(6216, () -> service.validateDatasource(customDs(
                "{\"class\":\"java.lang.String\",\"config_json\":{}}")));
    }

    @Test
    void customConfigJsonNotObjectRejected() {
        // 类合法（实现 CustomFetcher），config_json 非对象 → 6217
        assertCode(6217, () -> service.validateDatasource(customDs(
                "{\"class\":\"com.mis.recon.service.pull.TestStaticFetcher\",\"config_json\":\"oops\"}")));
    }

    @Test
    void customConnCodeSetRejected() {
        DatasourceSaveReq req = customDs("{\"class\":\"com.mis.recon.custom.example.CrossSystemIdMatcher\",\"config_json\":{}}");
        req.setConnCode("mysql_x");
        assertCode(1001, () -> service.validateDatasource(req));
    }

    @Test
    void customValidConfigPasses() {
        // example 包实现类需实现 CustomFetcher 才能通过；这里用测试实现类（跨包可见）
        assertDoesNotThrow(() -> service.validateDatasource(customDs(
                "{\"class\":\"com.mis.recon.service.pull.TestStaticFetcher\",\"config_json\":{\"path\":\"/data\"}}")));
    }

    private void assertCode(int expected, Runnable action) {
        BizException ex = assertThrows(BizException.class, action::run);
        assertEquals(expected, ex.getCode());
    }
}
