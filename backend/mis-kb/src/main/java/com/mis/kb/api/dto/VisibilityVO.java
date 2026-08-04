package com.mis.kb.api.dto;

import java.util.List;

/**
 * 可见范围视图（A-02a 运营排障 / L-06 库详情）。
 *
 * @param secrecy 密级码值（public/internal/secret/confidential）
 * @param acls    授权摘要列表
 */
public record VisibilityVO(
        String secrecy,
        List<AclSummaryVO> acls) {

    /** 空可见范围（无关联库时使用）。 */
    public static VisibilityVO empty() {
        return new VisibilityVO(null, List.of());
    }
}
