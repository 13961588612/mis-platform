package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;
import java.util.List;

/** 检索请求。libraryIds 为空表示在用户可见范围内全量检索。 */
public record RetrieveRequest(
        @NotBlank String question,
        List<Long> libraryIds,
        Integer topK,
        Double threshold) {
}
