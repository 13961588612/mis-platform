package com.mis.kb.api.dto;

import jakarta.validation.constraints.NotBlank;

import java.time.Instant;
import java.util.List;

/**
 * 检索请求。libraryIds 为空表示在用户可见范围内全量检索。
 *
 * <p><b>企业级增强一期（KE-08/KE-09）新增末位三字段：</b>
 * {@code documentIds}（按文档过滤，MIS 文档 id）+ {@code uploadFrom}/{@code uploadTo}
 * （按上传时间过滤，{@code kb_document.created_at}）。三者均未设置 = 不过滤，
 * 行为与现状一致（适配器不下发 {@code document_ids} 键）。
 *
 * @param question     问题文本（必填）
 * @param libraryIds   知识库 id 列表；空 = 可见范围全量
 * @param topK         单次问答覆盖召回条数；{@code null} = 用库级设置
 * @param threshold    单次问答覆盖相似度阈值；{@code null} = 用库级设置
 * @param documentIds  按文档过滤：MIS 文档 id 列表；空 = 不过滤（企业级增强一期新增）
 * @param uploadFrom   按上传时间过滤下界（含）；{@code null} = 不限制（企业级增强一期新增）
 * @param uploadTo     按上传时间过滤上界（含）；{@code null} = 不限制（企业级增强一期新增）
 */
public record RetrieveRequest(
        @NotBlank String question,
        List<Long> libraryIds,
        Integer topK,
        Double threshold,
        List<Long> documentIds,
        Instant uploadFrom,
        Instant uploadTo) {
}
