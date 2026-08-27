package com.mis.recon.service.engine;

import com.mis.recon.common.BizException;
import com.mis.recon.dao.DetailDao;
import com.mis.recon.dao.DiffHandleDao;
import com.mis.recon.domain.dto.DiffHandleReq;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 差异人工处理单测（T07-spec §6 G30）：合法三值处理 + unhandled 拒绝。
 */
class DiffHandleServiceTest {

    private DiffHandleDao dao;
    private DetailDao detailDao;
    private DiffHandleService service;

    @BeforeEach
    void setUp() {
        dao = mock(DiffHandleDao.class);
        detailDao = mock(DetailDao.class);
        service = new DiffHandleService(dao, detailDao);
    }

    /** service.handle/revert 先 findById 校验差异存在，未打桩的 mock 返回 null 会抛 RESOURCE_NOT_FOUND。 */
    private void stubDetail(long id) {
        when(detailDao.findById(id)).thenReturn(new DetailDao.DetailRow(
                id, "online_order", "c1", "-", "k", "k", "unmatched_left", "pending",
                null, null, null, null, null, null, "diff", 0L, 0L, null, "pending",
                null, 0, null, null, null, null, null));
    }

    private DiffHandleReq req(String status) {
        DiffHandleReq r = new DiffHandleReq();
        r.setHandleStatus(status);
        r.setOperator("zhang3");
        r.setRemark("人工核对无误");
        return r;
    }

    @Test
    void handleWritesRecordAndUpdatesDetail() {
        stubDetail(100L);
        when(dao.insert(100L, "handled", "zhang3", "人工核对无误")).thenReturn(7L);
        long id = service.handle(100L, req("handled"));
        assertEquals(7L, id);
        verify(dao).updateDetailHandle(100L, "handled");
    }

    @Test
    void ignoresAndFalsePositiveAccepted() {
        stubDetail(1L);
        stubDetail(2L);
        when(dao.insert(1L, "ignored", "zhang3", "人工核对无误")).thenReturn(1L);
        assertEquals(1L, service.handle(1L, req("ignored")));
        when(dao.insert(2L, "false_positive", "zhang3", "人工核对无误")).thenReturn(2L);
        assertEquals(2L, service.handle(2L, req("false_positive")));
        verify(dao).updateDetailHandle(1L, "ignored");
        verify(dao).updateDetailHandle(2L, "false_positive");
    }

    @Test
    void unhandledRejected() {
        assertThrows(BizException.class, () -> service.handle(1L, req("unhandled")));
    }

    @Test
    void illegalStatusRejected() {
        assertThrows(BizException.class, () -> service.handle(1L, req("foo")));
    }
}