package com.mis.kb.domain.model;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 模型池快照（T02 缓存对象；降级语义见设计 §8-6）。
 *
 * <p><b>available=false 表示探测失败/引擎不可达，绝不当空列表</b>——前端据此渲染告警态，
 * 而不是把「拉不到模型」误当「平台没有模型」展示成空下拉（设计 §1.1 降级不许展示假选项）。
 *
 * <p>{@code globalRerankModelId} = 全局配置 {@code mis.kb.engine.rerank-model-id}（可能为空串），
 * 由适配器注入，供前端标注「默认项 = 全局」以及 T03 检索期回退判定。
 *
 * @param embedding            embedding 模型列表（不可变）
 * @param rerank               rerank 模型列表（不可变）
 * @param available            探测是否成功
 * @param degradedReason       不可用原因（available=true 时可为 null）
 * @param globalRerankModelId  全局重排模型 id（可为空串）
 * @param probedAt             探测时间
 */
public record EngineModelPool(
        List<EngineModel> embedding,
        List<EngineModel> rerank,
        boolean available,
        String degradedReason,
        String globalRerankModelId,
        Instant probedAt) {

    /**
     * 构造不可用池（探测失败/引擎不支持时的统一降级出口）。
     *
     * @param reason              降级原因（写进日志与前端告警）
     * @param globalRerankModelId 全局重排模型 id（原样透传）
     * @return available=false 的池实例
     */
    public static EngineModelPool unavailable(String reason, String globalRerankModelId) {
        return new EngineModelPool(
                List.of(), List.of(), false, reason, globalRerankModelId, Instant.now());
    }

    /**
     * rerank 全限定 id 集合（供 T03 Resolver 快速判定「库级模型是否在池内」）。
     *
     * @return 池内 rerank id 集合；不可用/空池返回空集
     */
    public Set<String> rerankIds() {
        return rerank.stream().map(EngineModel::id).collect(Collectors.toSet());
    }
}
