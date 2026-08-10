package com.mis.kb.domain.model;

/**
 * 模型池项（T02，R-P0-01/02/04）。
 *
 * <p>{@code id} = <b>全限定 id</b>（T00 实测：embedding 与 rerank 均为
 * {@code name@instance_name@provider_name}，如 {@code text-embedding-v3@Tongyi-Qianwen@Tongyi-Qianwen}）。
 * RAGFlow 裸模型名会被拒（embedding code:101、rerank code:100），因此模型池下发的
 * id 必须是全限定格式，创建/检索直接可用。
 *
 * <p>{@code dimension} / {@code language}：本实例列表接口不提供，恒为 {@code null}
 * （T00 实测；前端下拉「名称(维度·语言)」在这两个字段为空时省略后缀展示）。
 *
 * @param id        全限定 id（下发 RAGFlow 即用）
 * @param name      模型名（展示用）
 * @param type      分类 embedding | rerank
 * @param provider  提供方名
 * @param dimension 向量维度（列表接口不提供时 null）
 * @param language  语言（列表接口不提供时 null）
 */
public record EngineModel(
        String id,
        String name,
        String type,
        String provider,
        Integer dimension,
        String language) {

    /** 分类码值：向量模型。 */
    public static final String TYPE_EMBEDDING = "embedding";
    /** 分类码值：重排模型。 */
    public static final String TYPE_RERANK = "rerank";
}
