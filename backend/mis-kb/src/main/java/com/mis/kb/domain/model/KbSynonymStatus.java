package com.mis.kb.domain.model;

/**
 * 术语组状态码常量（Wave D）。
 *
 * <p>与 {@code KbSynonymGroup.STATUS_ENABLED / STATUS_DISABLED} 同值。
 * 单独抽一份放在 {@code domain.model} 是为了让<b>不依赖 JPA 实体</b>的纯值对象
 * （{@link SynonymParsedGroup}、{@link SynonymImportPlanRow}）也能引用状态码，
 * 而不必为两个 int 常量把 {@code jakarta.persistence} 拖进值对象的依赖里。
 *
 * <p>⚠️ 改动其中任何一个值，必须同步改 {@code KbSynonymGroup} 与 V18 迁移里的 DEFAULT。
 */
public final class KbSynonymStatus {

    /** 启用：参与同义词扩展。 */
    public static final int ENABLED = 1;

    /**
     * 停用：不参与扩展，但<b>仍占用词条唯一性</b>（Q3 裁决）。
     *
     * <p>这不是遗漏——若停用即释放唯一性，会出现「停用 A 组 → 词被 B 组抢走 →
     * A 组再也启用不了」的死结。
     */
    public static final int DISABLED = 0;

    private KbSynonymStatus() {
    }
}
