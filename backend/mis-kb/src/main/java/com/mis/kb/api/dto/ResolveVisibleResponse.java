package com.mis.kb.api.dto;

import java.util.List;

/** 可见知识库解析响应（供 mis-rag 编排使用）。 */
public record ResolveVisibleResponse(List<Long> libraryIds) {
}
