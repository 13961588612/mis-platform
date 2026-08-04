package com.mis.adminbff.dto.kb;

import java.time.Instant;

/** 知识库 ACL 视图（BFF 侧镜像）。 */
public record KbAclVO(
        Long id,
        Long libraryId,
        String subjectType,
        Long subjectId,
        String action,
        Instant createdAt,
        Instant updatedAt) {
}
