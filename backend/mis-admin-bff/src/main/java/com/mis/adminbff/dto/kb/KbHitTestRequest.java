package com.mis.adminbff.dto.kb;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.Instant;
import java.util.List;

/**
 * 命中测试请求（BFF 侧镜像，字段与 mis-kb {@code HitTestRequest} 一一对齐）。
 *
 * <p>本层<b>不做业务加工</b>：不补默认值、不校正参数、不判 ACL——这些全部由 mis-kb 裁定。
 * BFF 只负责鉴权（{@code kb:hittest:run}）、审计（{@code @OperLog}）与透传。
 *
 * <p>注意<b>没有</b> {@code userId} 字段：身份走 {@code X-User-Id} 透传头，
 * 请求体里带 userId 等于给越权开了个正门。
 *
 * <p><b>企业级增强一期（KE-08/KE-09）新增末位三字段</b>：{@code documentIds} +
 * {@code uploadFrom}/{@code uploadTo}（文档/上传时间过滤）。本层只透传，
 * 过滤解析、能力降级统一由 mis-kb 裁定。record 是位置参数，新字段一律追加末位。
 *
 * @param libraryId              目标知识库 id（必填，单库）
 * @param question               测试问题
 * @param topK                   临时覆盖召回条数
 * @param threshold              临时覆盖相似度阈值
 * @param retrievalMethod        临时覆盖检索方式 vector/keyword/hybrid
 * @param vectorSimilarityWeight 临时覆盖向量相似度权重
 * @param rerank                 临时覆盖重排开关
 * @param disableSynonym         本次测试是否不使用同义词扩展（Wave D / WD-11）。
 *                               <b>末位追加</b>——record 是位置参数，插中间会让既有构造点静默错位。
 *                               本层只透传，不解释：{@code null} 与 {@code false} 的语义收敛
 *                               统一由 mis-kb 侧 {@code HitTestRequest#synonymDisabledForThisRun()} 裁定，
 *                               两边各判一次迟早会出现「BFF 认为不禁用、kb 认为禁用」的错位
 * @param documentIds            按文档过滤：MIS 文档 id 列表；空 = 不过滤（企业级增强一期新增）
 * @param uploadFrom             按上传时间过滤下界（含）；{@code null} = 不限制（企业级增强一期新增）
 * @param uploadTo               按上传时间过滤上界（含）；{@code null} = 不限制（企业级增强一期新增）
 */
public record KbHitTestRequest(
        @NotNull Long libraryId,
        @NotBlank @Size(max = 2000) String question,
        Integer topK,
        Double threshold,
        String retrievalMethod,
        Double vectorSimilarityWeight,
        Boolean rerank,
        Boolean disableSynonym,
        List<Long> documentIds,
        Instant uploadFrom,
        Instant uploadTo) {
}
