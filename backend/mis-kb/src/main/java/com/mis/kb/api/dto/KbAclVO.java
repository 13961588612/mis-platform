package com.mis.kb.api.dto;

import java.time.Instant;

/** ACL 视图对象。 */
public record KbAclVO(
        Long id,
        Long libraryId,
        String subjectType,
        Long subjectId,
        String action,
        Instant createdAt,
        Instant updatedAt) {
}
