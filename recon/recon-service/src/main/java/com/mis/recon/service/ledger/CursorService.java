package com.mis.recon.service.ledger;

import com.mis.recon.dao.CursorDao;

/**
 * 消费游标服务（F87，per-check 粒度）。
 * <p>T04 建好，T05 ReconRunner 消费时调用（get 起点 / advance 推进）。</p>
 */
@org.springframework.stereotype.Service
public class CursorService {

    private final CursorDao cursorDao;

    public CursorService(CursorDao cursorDao) {
        this.cursorDao = cursorDao;
    }

    public long get(String scenarioCode, String checkName, String dsCode) {
        return cursorDao.get(scenarioCode, checkName, dsCode);
    }

    public void advance(String scenarioCode, String checkName, String dsCode, long hi) {
        cursorDao.advance(scenarioCode, checkName, dsCode, hi);
    }
}
