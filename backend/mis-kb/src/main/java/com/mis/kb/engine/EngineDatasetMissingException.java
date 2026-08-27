package com.mis.kb.engine;

import com.mis.common.core.exception.BusinessException;

/**
 * 引擎侧数据集已不存在的跨层信号（Q1 判定口径）。
 *
 * <p>由 {@link RagflowClient} 在两类场景抛出：
 * <ul>
 *   <li>{@code deleteDataset}：HTTP 404（原「404 静默幂等」改为抛本异常）；</li>
 *   <li>{@code renameDataset}：HTTP 404，或业务响应 {@code code != 0} 且 message 命中
 *       缺失关键字（{@code not found / not exist / 不存在 / missing}，不区分大小写）。</li>
 * </ul>
 *
 * <p>本异常是「跨 client → service 的 missing 信号」：{@link RagflowAdapter} 原样透传，
 * {@code KbLibraryService} 捕获后进入两段式确认流——{@code force=false} 返回提示态 VO
 * （本地零变更，HTTP 200），{@code force=true} 跳过引擎直接本地删除/归档。
 *
 * <p><b>判定边界：</b>引擎不可达/超时是 {@code ResourceAccessException}，<b>不是</b>
 * 本异常——那是「不知道引擎状态」，不是「确认引擎侧已缺失」，绝不能混为一谈。
 *
 * <p>业务码沿用 50000（与 RagflowClient 其它引擎调用失败同段），仅靠类型区分信号，
 * 调用方以 {@code catch (EngineDatasetMissingException)} 分流，不依赖业务码。
 */
public class EngineDatasetMissingException extends BusinessException {

    private static final long serialVersionUID = 1L;

    /** 业务码：与 RagflowClient 既有引擎调用失败的 50000 同段，仅类型不同用于分流。 */
    public static final int CODE = 50000;

    /**
     * 构造 missing 信号异常。
     *
     * @param message 给调用方/日志的说明（含引擎侧响应细节）
     */
    public EngineDatasetMissingException(String message) {
        super(CODE, message);
    }
}
