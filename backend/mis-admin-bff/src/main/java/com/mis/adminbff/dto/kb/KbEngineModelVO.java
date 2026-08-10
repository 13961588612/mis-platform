package com.mis.adminbff.dto.kb;

/**
 * 模型池项（BFF 侧镜像，与 mis-kb {@code EngineModel} 对齐）。
 *
 * <p>{@code id} = 全限定 id（如 {@code text-embedding-v3@Tongyi-Qianwen@Tongyi-Qianwen}），
 * 创建/检索直接可用；{@code dimension}/{@code language} 本实例列表接口不提供时为 null。
 *
 * @param id        全限定 id
 * @param name      模型名（展示用）
 * @param type      分类 embedding | rerank
 * @param provider  提供方名
 * @param dimension 向量维度（可为 null）
 * @param language  语言（可为 null）
 */
public record KbEngineModelVO(
        String id,
        String name,
        String type,
        String provider,
        Integer dimension,
        String language) {
}
