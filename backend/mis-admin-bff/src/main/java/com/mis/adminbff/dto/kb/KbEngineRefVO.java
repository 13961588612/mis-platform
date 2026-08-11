package com.mis.adminbff.dto.kb;

import java.time.Instant;

/**
 * 知识库引擎引用（BFF 侧镜像，Q4 有限暴露 dataset_id）。
 *
 * <p><b>这条链路是全仓库唯一被允许把 {@code engineLibraryRef} 透到前端的路径</b>，
 * 成立的前提是三件套齐备，缺一不可：
 * <ol>
 *   <li>独立权限码 {@code kb:library:engine-ref:view}（V26 已登记 sys_api）；</li>
 *   <li>BFF 端点上的 {@code @OperLog}（谁在什么时候看了哪个库的 dataset_id 全部留痕）；</li>
 *   <li>不并入 {@link KbLibraryVO}——列表接口一旦带上就是全量泄露。</li>
 * </ol>
 *
 * @param libraryId        MIS 知识库 ID
 * @param engineType       引擎类型
 * @param engineLibraryRef 引擎侧 dataset 原生 ID
 * @param engineSyncStatus 同步状态码（0 未知 / 1 一致 / 2 引擎缺失 / 3 漂移或失败）
 * @param engineCheckedAt  最近一次对账 / 同步时刻
 */
public record KbEngineRefVO(
        Long libraryId,
        String engineType,
        String engineLibraryRef,
        Integer engineSyncStatus,
        Instant engineCheckedAt) {
}
