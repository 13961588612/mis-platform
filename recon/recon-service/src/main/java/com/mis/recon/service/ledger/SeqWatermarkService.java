package com.mis.recon.service.ledger;

import com.mis.recon.dao.WatermarkDao;

import java.util.Map;

/**
 * 水位服务（F86）：每批提交后更新 committed_seq（T04-spec G5）。
 */
@org.springframework.stereotype.Service
public class SeqWatermarkService {

    private final WatermarkDao watermarkDao;

    public SeqWatermarkService(WatermarkDao watermarkDao) {
        this.watermarkDao = watermarkDao;
    }

    public void commit(String dsCode, long seq) {
        watermarkDao.commit(dsCode, seq);
    }

    /** 全部 ds 水位（T05 ReconRunner 冻结上界 hi 用）。 */
    public Map<String, Long> getAll() {
        return watermarkDao.getAll();
    }
}
