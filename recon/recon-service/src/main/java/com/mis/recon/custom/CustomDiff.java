package com.mis.recon.custom;

import lombok.Builder;
import lombok.Data;

/**
 * 整检查差异条目（strategy=custom_check 出参，直接 confirmed）。
 * <p>身份（matchKeyHash/matchKeyDisplay）由实现类决定；diffDesc 写入差异描述；
 * diffAmountCent/diffPoint 可选（金额/积分差额展示）；锚点由引擎按左侧行生成。</p>
 */
@Data
@Builder
public class CustomDiff {

    private String matchKeyHash;        // 差异身份（必填，唯一确定一条差异）
    private String matchKeyDisplay;     // 可读值（展示）
    private String diffDesc;            // 差异描述
    private Long diffAmountCent;        // 金额差额（分，可选）
    private Long diffPoint;             // 积分差额（可选）
    private String leftDataJson;        // 左侧现场数据（可选）
    private String rightDataJson;       // 右侧现场数据（可选）
}
