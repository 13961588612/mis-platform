package com.mis.adminbff.dto.kb;

import java.util.List;

/**
 * 模型池快照（BFF 侧镜像，与 mis-kb {@code EngineModelPool} 对齐）。
 *
 * <p>{@code available=false} 表示探测失败/引擎不可达，前端据此渲染告警态，<b>绝不当空列表</b>
 * （设计 §8-6 降级语义）。{@code globalRerankModelId} = 全局配置重排模型 id（可为空串），
 * 供前端标注「默认项 = 全局」。
 *
 * @param embedding           embedding 模型列表
 * @param rerank              rerank 模型列表
 * @param available           探测是否成功
 * @param degradedReason      不可用原因（available=true 时可为 null）
 * @param globalRerankModelId 全局重排模型 id（可为空串）
 * @param probedAt            探测时间（ISO 字符串）
 */
public record KbEngineModelPoolVO(
        List<KbEngineModelVO> embedding,
        List<KbEngineModelVO> rerank,
        boolean available,
        String degradedReason,
        String globalRerankModelId,
        String probedAt) {
}
