package com.mis.recon.service.engine;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.mis.recon.dao.DetailDao;
import com.mis.recon.dao.MatchedIndexDao;
import com.mis.recon.dao.PullRunDao;
import com.mis.recon.domain.ledger.ReconSourceRecord;
import com.mis.recon.domain.runtime.CompareResult;
import com.mis.recon.domain.runtime.LedgerRow;
import com.mis.recon.domain.runtime.Mismatch;
import com.mis.recon.util.HashUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * VerdictService.applySumCheck 判定单测（T05-spec-sum-check §13.3 S-3/S-4/S-5 判定语义；
 * 全链路消费/勾稽走实库 MIS_TEST_DB 回归，本组覆盖差异落池 + 配平出池 + 幂等）。
 */
class SumCheckVerdictTest {

    private DetailDao detailDao;
    private VerdictService service;

    @BeforeEach
    void setUp() {
        detailDao = Mockito.mock(DetailDao.class);
        MatchedIndexDao matchedIndexDao = Mockito.mock(MatchedIndexDao.class);
        PullRunDao pullRunDao = Mockito.mock(PullRunDao.class);
        CompareEngine compareEngine = new CompareEngine(Mockito.mock(CustomLoader.class));
        DiffDescBuilder diffDescBuilder = new DiffDescBuilder();
        DiagnosisBuilder diagnosisBuilder = new DiagnosisBuilder(new ObjectMapper());
        service = new VerdictService(detailDao, matchedIndexDao, pullRunDao,
                compareEngine, diffDescBuilder, diagnosisBuilder);
    }

    private ConfigSnapshot.LoadedScenario scenario() {
        ConfigSnapshot.LoadedScenario s = new ConfigSnapshot.LoadedScenario();
        s.scenarioCode = "sc";
        return s;
    }

    private ConfigSnapshot.CheckSpec check() {
        ConfigSnapshot.CheckSpec c = new ConfigSnapshot.CheckSpec();
        c.checkName = "c1";
        c.strategy = "sum_check";
        return c;
    }

    private LedgerRow row(String recordKey, String json) {
        ReconSourceRecord rec = ReconSourceRecord.builder().dsCode("d1").recordKey(recordKey).updateSeq(1L).build();
        LedgerRow r = LedgerRow.of(rec, "incr");
        try {
            r.setRecordData(new ObjectMapper().readTree(json));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
        return r;
    }

    private DetailDao.IdentityState state(String status) {
        return new DetailDao.IdentityState(7L, "field_mismatch", status, null, null, null, 0);
    }

    private CompareResult mismatch() {
        return CompareResult.fail(List.of(new Mismatch("总额勾稽", "100.00", "99.00", "null", "equal")), 100L, 1);
    }

    @Test
    void inconsistentRowConfirmsWithRecordKeyHash() {
        // S-3 判定：不一致 → upsertDetail(confirmed + SHA-256(record_key)) + side=left 锚 + 状态历史
        when(detailDao.findIdentity(eq("sc"), eq("c1"), eq("-"), eq(HashUtil.sha256Hex("K001")))).thenReturn(null);
        when(detailDao.upsertDetail(any())).thenReturn(11L);

        VerdictService.Stats stats = new VerdictService.Stats();
        service.applySumCheck(scenario(), check(), row("K001", "{\"a\":\"1\"}"), mismatch(), stats);

        ArgumentCaptor<DetailDao.DetailUpsert> captor = ArgumentCaptor.forClass(DetailDao.DetailUpsert.class);
        verify(detailDao).upsertDetail(captor.capture());
        DetailDao.DetailUpsert up = captor.getValue();
        assertEquals("field_mismatch", up.diffType);
        assertEquals("confirmed", up.status);
        assertEquals(HashUtil.sha256Hex("K001"), up.identity.matchKeyHash);
        assertEquals("K001", up.matchKeyDisplay);
        assertEquals(100L, up.diffAmountCent);
        ArgumentCaptor<List<DetailDao.AnchorRow>> anchorCaptor = ArgumentCaptor.forClass(List.class);
        verify(detailDao).upsertAnchors(eq(11L), anchorCaptor.capture());
        List<DetailDao.AnchorRow> anchors = anchorCaptor.getValue();
        assertEquals(1, anchors.size());
        assertEquals("left", anchors.get(0).side);
        assertEquals("d1", anchors.get(0).dsCode);
        assertEquals("K001", anchors.get(0).recordKey);
        verify(detailDao).touchConfirmedAt(11L);
        verify(detailDao).insertStatusHistory(11L, "status", null, "confirmed", "sum_check", null);
        assertEquals(1, stats.diff);
        assertEquals(0, stats.resolved);
    }

    @Test
    void consistentRowResolvesPoolDiff() {
        // S-4 判定：重跑一致 + 池内旧差异 → markResolved + 状态历史 reason=sum_check_matched
        when(detailDao.findIdentity(eq("sc"), eq("c1"), eq("-"), eq(HashUtil.sha256Hex("K001"))))
                .thenReturn(state("pending"));

        VerdictService.Stats stats = new VerdictService.Stats();
        service.applySumCheck(scenario(), check(), row("K001", "{\"a\":\"1\"}"), CompareResult.ok(1), stats);

        verify(detailDao).markResolved(7L);
        verify(detailDao).insertStatusHistory(7L, "status", "pending", "resolved", "sum_check_matched", null);
        assertEquals(0, stats.diff);
        assertEquals(1, stats.resolved);
        verify(detailDao, never()).upsertDetail(any());
    }

    @Test
    void consistentRowWithoutIdentityIsNoop() {
        // S-5 判定：重跑一致且无旧差异 → 无任何写（幂等）
        when(detailDao.findIdentity(eq("sc"), eq("c1"), eq("-"), eq(HashUtil.sha256Hex("K001")))).thenReturn(null);

        VerdictService.Stats stats = new VerdictService.Stats();
        service.applySumCheck(scenario(), check(), row("K001", "{\"a\":\"1\"}"), CompareResult.ok(1), stats);

        verify(detailDao, never()).markResolved(anyLong());
        verify(detailDao, never()).upsertDetail(any());
        verify(detailDao, never()).reopen(anyLong());
        assertEquals(0, stats.diff);
        assertEquals(0, stats.resolved);
    }

    @Test
    void resolvedDiffReopensOnNewMismatch() {
        // 状态机回归：已 resolved 差异再次不一致 → reopen + 写 confirmed
        when(detailDao.findIdentity(eq("sc"), eq("c1"), eq("-"), eq(HashUtil.sha256Hex("K001"))))
                .thenReturn(state("resolved"));
        when(detailDao.upsertDetail(any())).thenReturn(11L);

        VerdictService.Stats stats = new VerdictService.Stats();
        service.applySumCheck(scenario(), check(), row("K001", "{\"a\":\"1\"}"), mismatch(), stats);

        verify(detailDao).reopen(7L);
        ArgumentCaptor<DetailDao.DetailUpsert> captor = ArgumentCaptor.forClass(DetailDao.DetailUpsert.class);
        verify(detailDao).upsertDetail(captor.capture());
        assertEquals("confirmed", captor.getValue().status);
        assertEquals(1, stats.diff);
    }
}
