package com.mis.recon.domain.dto;

import jakarta.validation.constraints.Pattern;
import lombok.Data;

/**
 * 差异详情页单条重拉请求（V4）。side 缺省两侧都拉。
 * <p>与现有 {@link FetchOneReq}（OpsController 用，按 dsCode+recordKey）不同：本类按 detail_id + 锚表自动取 dsCode/recordKey。</p>
 */
@Data
public class DiffFetchOneReq {

    /** 重拉侧：left/right/null（null 表示两侧都拉） */
    @Pattern(regexp = "left|right", message = "side 仅支持 left / right")
    private String side;
}
