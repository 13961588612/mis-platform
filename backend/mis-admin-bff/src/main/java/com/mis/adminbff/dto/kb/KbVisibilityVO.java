package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 会话可见范围快照（A-02a，BFF 侧镜像）。
 *
 * @param secrecy 本次问答命中知识库中的<b>最高</b>密级（最严口径）
 * @param acls    命中库的授权摘要
 */
public record KbVisibilityVO(
        String secrecy,
        List<KbAclSummaryVO> acls) {
}
