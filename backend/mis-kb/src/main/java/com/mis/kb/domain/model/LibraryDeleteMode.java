package com.mis.kb.domain.model;

import java.util.Locale;

/**
 * 知识库「删除」端点的模式（引擎删除策略 P0 / T01）。
 *
 * <p><b>破坏性语义变更提醒：</b>{@code DELETE /api/v1/kb/libraries/{id}} 不带 {@code mode}
 * 时，行为从旧版的「物理删（且吞异常假成功）」变成 {@link #ARCHIVE 归档}。回执 message
 * 必须明说「已归档，未删除引擎数据」，否则运维会以为数据已经清干净。
 *
 * <table border="1">
 *   <caption>模式语义</caption>
 *   <tr><th>wire 值</th><th>引擎侧动作</th><th>本地动作</th></tr>
 *   <tr><td>{@code archive}</td><td>{@code PUT dataset.name = 归档名}</td>
 *       <td>{@code status=0} + {@code archived_at=now}，不清文档 / 不清 ACL</td></tr>
 *   <tr><td>{@code physical}</td><td>{@code DELETE dataset}</td>
 *       <td>删 {@code kb_document} → {@code kb_acl} → {@code kb_library}</td></tr>
 * </table>
 *
 * <p><b>「停用」不在本枚举内</b>：沿用既有 {@code PUT /libraries/{id}} + {@code status=0}，
 * 不要为它新造分支。<b>也不存在 {@code FORCE_UNBIND}</b>（Q10 明确不做），谁都别顺手加。
 */
public enum LibraryDeleteMode {

    /** 归档（默认）：引擎侧改名保留数据，本地停用并打归档标记。 */
    ARCHIVE("archive"),

    /** 物理删除：引擎侧删 dataset 成功后才清本地三表；引擎不支持时整体被拒。 */
    PHYSICAL("physical");

    private final String wire;

    LibraryDeleteMode(String wire) {
        this.wire = wire;
    }

    /**
     * 传输层取值（小写）。
     *
     * @return {@code archive} 或 {@code physical}
     */
    public String wire() {
        return wire;
    }

    /**
     * 解析前端传入的 {@code mode} 参数。
     *
     * <p>{@code null} / 空白一律回落到 {@link #ARCHIVE}（这是接口的默认语义）；
     * 其余非法值返回 {@code null}，由调用方抛 {@code VALIDATION_ERROR}——
     * <b>不要静默回落</b>，否则用户拼错 "physicial" 时会以为自己删掉了实际只归档了。
     *
     * @param raw 原始入参，允许 {@code null}
     * @return 匹配的模式；非法值返回 {@code null}
     */
    public static LibraryDeleteMode parse(String raw) {
        if (raw == null || raw.isBlank()) {
            return ARCHIVE;
        }
        String normalized = raw.trim().toLowerCase(Locale.ROOT);
        for (LibraryDeleteMode mode : values()) {
            if (mode.wire.equals(normalized)) {
                return mode;
            }
        }
        return null;
    }
}
