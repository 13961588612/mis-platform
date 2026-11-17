package com.mis.recon.domain.dto;

import com.mis.recon.dao.DetailDao;
import lombok.Data;

import java.util.List;

/**
 * 差异详情响应（V4 详情页用）：单条差异全字段 + 锚表 + 处理历史 + 状态历史 + check 比较规则元信息。
 * <p>DetailRow/AnchorRow/HandleHistoryRow/StatusHistoryRow 直接复用 DAO 内部类（public 字段，Jackson 默认可序列化）。</p>
 */
@Data
public class DiffDetailResp {

    /** 单条差异全字段（含所有时间戳） */
    private DetailDao.DetailRow detail;

    /** 锚表行（left/right + ds_code + record_key） */
    private List<DetailDao.AnchorRow> anchors;

    /** 人工处理历史（recon_diff_handle，按 id 升序） */
    private List<DetailDao.HandleHistoryRow> handleHistory;

    /** 状态流转历史（recon_diff_status_history，按 id 升序） */
    private List<DetailDao.StatusHistoryRow> statusHistory;

    /** check 的比较规则元信息（前端识别金额字段用） */
    private List<CompareRuleMeta> checkCompareRules;
}
