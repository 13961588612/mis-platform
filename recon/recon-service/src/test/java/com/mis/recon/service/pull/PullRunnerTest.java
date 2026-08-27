package com.mis.recon.service.pull;

import com.mis.recon.common.BizException;
import com.mis.recon.domain.config.ReconConnection;
import com.mis.recon.domain.config.ReconDatasource;
import com.mis.recon.repository.ConnectionRepository;
import com.mis.recon.repository.DatasourceRepository;
import com.mis.recon.service.engine.ReadinessGateEvaluator;
import com.mis.recon.service.ledger.HealthEvaluator;
import com.mis.recon.service.ledger.LedgerService;
import com.mis.recon.service.ledger.SeqWatermarkService;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.service.support.ConnectionPoolManager;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.PlatformTransactionManager;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * PullRunner 单测（mock 依赖；覆盖配置快照校验路径 + 互斥 + fetch_one 缺配置）。
 * <p>窗口衔接 / 键集分页 / 批事务属实库验证（验收 1~4），不 gate mvn test。</p>
 */
class PullRunnerTest {

    private DatasourceRepository datasourceRepository;
    private ConnectionRepository connectionRepository;
    private ConnectionPoolManager connectionPoolManager;
    private LedgerService ledgerService;
    private SeqWatermarkService seqWatermarkService;
    private PullRunDao pullRunDao;
    private HealthEvaluator healthEvaluator;
    private PlatformTransactionManager txManager;
    private ReadinessGateEvaluator readinessGateEvaluator;
    private com.mis.recon.service.engine.CustomLoader customLoader;
    private PullRunner pullRunner;

    @BeforeEach
    void setUp() {
        datasourceRepository = mock(DatasourceRepository.class);
        connectionRepository = mock(ConnectionRepository.class);
        connectionPoolManager = mock(ConnectionPoolManager.class);
        ledgerService = mock(LedgerService.class);
        seqWatermarkService = mock(SeqWatermarkService.class);
        pullRunDao = mock(PullRunDao.class);
        healthEvaluator = mock(HealthEvaluator.class);
        txManager = mock(PlatformTransactionManager.class);
        readinessGateEvaluator = mock(ReadinessGateEvaluator.class);
        customLoader = mock(com.mis.recon.service.engine.CustomLoader.class);
        pullRunner = new PullRunner(datasourceRepository, connectionRepository, connectionPoolManager,
                ledgerService, seqWatermarkService, pullRunDao, healthEvaluator, txManager,
                readinessGateEvaluator, customLoader);
    }

    @Test
    void dsNotFoundThrows3002() {
        when(datasourceRepository.findByDsCode("nope")).thenReturn(Optional.empty());
        BizException ex = assertThrows(BizException.class, () -> pullRunner.run("nope"));
        assertEquals(3002, ex.getCode());
    }

    @Test
    void disabledDsThrows7003() {
        ReconDatasource ds = ds();
        ds.setEnabled(0);
        when(datasourceRepository.findByDsCode("huadi2_order")).thenReturn(Optional.of(ds));
        BizException ex = assertThrows(BizException.class, () -> pullRunner.run("huadi2_order"));
        assertEquals(7003, ex.getCode());
    }

    @Test
    void apiFetchTypeWithoutUrlThrows7014() {
        // api 取数：fetch_config_json 缺失 url → 拉取引擎报 api 配置错误（7014）
        ReconDatasource ds = ds();
        ds.setFetchType("api");
        when(datasourceRepository.findByDsCode("huadi2_order")).thenReturn(Optional.of(ds));
        BizException ex = assertThrows(BizException.class, () -> pullRunner.run("huadi2_order"));
        assertEquals(7014, ex.getCode());
    }

    @Test
    void nonTimeFetchModeThrows7004() {
        ReconDatasource ds = ds();
        ds.setFetchConfigJson("{\"fetch_mode\":\"pk\",\"sql\":\"SELECT * FROM t\"}");
        when(datasourceRepository.findByDsCode("huadi2_order")).thenReturn(Optional.of(ds));
        BizException ex = assertThrows(BizException.class, () -> pullRunner.run("huadi2_order"));
        assertEquals(7004, ex.getCode());
    }

    @Test
    void missingSqlThrows7004() {
        ReconDatasource ds = ds();
        ds.setFetchConfigJson("{\"fetch_mode\":\"time\"}");
        when(datasourceRepository.findByDsCode("huadi2_order")).thenReturn(Optional.of(ds));
        BizException ex = assertThrows(BizException.class, () -> pullRunner.run("huadi2_order"));
        assertEquals(7004, ex.getCode());
    }

    @Test
    void connMissingThrows7008() {
        ReconDatasource ds = ds();
        when(datasourceRepository.findByDsCode("huadi2_order")).thenReturn(Optional.of(ds));
        when(connectionRepository.findByConnCode("mysql_huadi2")).thenReturn(Optional.empty());
        BizException ex = assertThrows(BizException.class, () -> pullRunner.run("huadi2_order"));
        assertEquals(7008, ex.getCode());
    }

    @Test
    void fetchOneMissingFetchOneSqlThrows7005() {
        ReconDatasource ds = ds();
        when(datasourceRepository.findByDsCode("huadi2_order")).thenReturn(Optional.of(ds));
        when(connectionRepository.findByConnCode("mysql_huadi2"))
                .thenReturn(Optional.of(conn()));
        when(connectionPoolManager.getDataSource(anyString())).thenReturn(mock(javax.sql.DataSource.class));
        when(ledgerService.resolveAmountSpec(any())).thenReturn(new com.mis.recon.dao.LedgerDao.AmountSpec());
        BizException ex = assertThrows(BizException.class,
                () -> pullRunner.fetchOne("huadi2_order", "A1001"));
        assertEquals(7005, ex.getCode());
    }

    @Test
    void concurrentRunThrows7001() {
        // 第一次 run 抛业务异常后 finally 已清理 running，第二次进入 loadCtx 报 3002（而非 7001）
        when(datasourceRepository.findByDsCode("x")).thenReturn(Optional.empty());
        assertThrows(BizException.class, () -> pullRunner.run("x"));
        BizException second = assertThrows(BizException.class, () -> pullRunner.run("x"));
        assertEquals(3002, second.getCode());
    }

    private ReconDatasource ds() {
        ReconDatasource ds = new ReconDatasource();
        ds.setDsCode("huadi2_order");
        ds.setConnCode("mysql_huadi2");
        ds.setFetchType("db");
        ds.setEnabled(1);
        ds.setRecordKeyExpression("{order_no}");
        ds.setTimeField("update_time");
        ds.setFetchConfigJson("{\"fetch_mode\":\"time\",\"sql\":\"SELECT order_no, update_time FROM t WHERE update_time >= :p_start AND update_time < :p_end\"}");
        return ds;
    }

    private ReconConnection conn() {
        ReconConnection c = new ReconConnection();
        c.setConnCode("mysql_huadi2");
        c.setType("mysql");
        c.setEnabled(1);
        c.setJdbcUrl("jdbc:mysql://127.0.0.1:3306/huadi2");
        return c;
    }
}
