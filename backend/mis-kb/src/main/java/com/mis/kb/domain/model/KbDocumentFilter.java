package com.mis.kb.domain.model;

import java.time.Instant;
import java.util.List;

/**
 * 文档过滤条件（KE-08 按文档过滤 / KE-09 按上传时间范围过滤）。
 *
 * <p>由 {@code RetrieveQuery} 的过滤字段解析而来，交 {@code KbDocumentRepository} /
 * 服务层按 {@code kb_document.created_at}（上传时间，主理人裁决 KE-09 用 created_at）
 * 与文档 id 集、enabled 状态过滤，最终合并为引擎原生 {@code document_ids} 下发。
 *
 * <p><b>R5 铁律：</b>过滤一律限定在「库内 + enabled=1」范围内解析；解析结果为空时
 * <b>不下发 document_ids 键</b>（引擎对不存在 id 会 code:102 拒整单，见设计 §1.5）。
 *
 * @param documentIds MIS 侧文档 id 集（{@code kb_document.id}）；空/不设 = 不过滤
 * @param uploadFrom  上传时间起点（含）；{@code null} = 不设下限
 * @param uploadTo    上传时间终点（含）；{@code null} = 不设上限
 * @param enabledOnly 是否仅过滤 enabled=1 文档；恒为 {@code true}（检索只命中启用文档）
 */
public record KbDocumentFilter(
        List<Long> documentIds,
        Instant uploadFrom,
        Instant uploadTo,
        Boolean enabledOnly) {

    /**
     * 便捷构造：enabledOnly 默认 {@code true}。
     *
     * @param documentIds MIS 侧文档 id 集，可为 {@code null}
     * @param uploadFrom  上传时间起点，可为 {@code null}
     * @param uploadTo    上传时间终点，可为 {@code null}
     */
    public KbDocumentFilter(List<Long> documentIds, Instant uploadFrom, Instant uploadTo) {
        this(documentIds, uploadFrom, uploadTo, Boolean.TRUE);
    }

    /**
     * 是否设置了任何过滤条件。
     *
     * @return 文档 id 集非空、或时间范围任一非空时返回 {@code true}
     */
    public boolean hasAnyCondition() {
        return (documentIds != null && !documentIds.isEmpty())
                || uploadFrom != null
                || uploadTo != null;
    }

    /**
     * 文档 id 集（null 归一化为空列表）。
     *
     * @return 非空列表；未设置时为 {@link List#of()}
     */
    public List<Long> safeDocumentIds() {
        return documentIds != null ? documentIds : List.of();
    }
}
