package com.mis.recon.service.alert;

import com.mis.recon.dao.AlertLogDao;
import com.mis.recon.util.HashUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 告警留痕服务（F105，T07-spec §4）：指纹生成/查重 + alert_log 写入。
 */
@Service
@RequiredArgsConstructor
public class AlertLogService {

    private final AlertLogDao alertLogDao;

    /** 内容指纹：SHA-256({scenario}|{check}|{sortedIds}|{severity})（G26）。 */
    public String fingerprint(String scenarioCode, String checkName, List<Long> detailIds, String severity) {
        List<Long> sorted = detailIds == null ? List.of()
                : detailIds.stream().sorted().toList();
        return HashUtil.sha256Hex(scenarioCode + "|" + checkName + "|" + sorted + "|" + severity);
    }

    /** 指纹已存在（重复投递防护）。 */
    public boolean exists(String fingerprint) {
        return alertLogDao.existsByFingerprint(fingerprint);
    }

    /** 落一条 alert_log（含指纹 / content / 发送状态）。 */
    public void record(String scenarioCode, String checkName, List<Long> detailIds,
                       String severity, String channel, String fingerprint,
                       String content, String sendStatus, String errMsg) {
        alertLogDao.insert(scenarioCode, checkName, detailIds, severity, channel,
                fingerprint, content, sendStatus, errMsg);
    }
}