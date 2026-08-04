package com.mis.kb.support;

import com.mis.common.core.exception.BusinessException;
import com.mis.kb.domain.model.KbResultCode;

/**
 * 词条唯一性冲突异常（40927），<b>携带结构化明细</b>。
 *
 * <p>与 {@link KbBusinessException} 的区别只有一点：本类走
 * {@link BusinessException#BusinessException(int, String, Object)} 这个带 {@code data} 的构造，
 * 使冲突明细能穿过全局异常处理器落到响应体的 {@code data} 字段。
 * 普通 {@code KbBusinessException} 的 {@code data} 恒为 {@code null}。
 *
 * <p><b>message 为什么要现拼而不用枚举默认值：</b>
 * {@link KbResultCode#KB_SYNONYM_TERM_CONFLICT} 的默认 message 是一句通用说明，
 * 而这里能拿到具体是哪个词、撞上了谁，拼进 message 后即便前端降级只显示 message，
 * 用户也知道该改哪一行。{@code data} 是给前端做交互（标红 + 跳转）用的，
 * message 是最后一道人类可读兜底，两者都要给。
 */
public class KbSynonymConflictException extends BusinessException {

    private static final long serialVersionUID = 1L;

    private final transient SynonymConflictDetail detail;

    /**
     * 构造。
     *
     * @param detail 冲突明细，三个字段都应尽力填满
     */
    public KbSynonymConflictException(SynonymConflictDetail detail) {
        super(KbResultCode.KB_SYNONYM_TERM_CONFLICT.getCode(), buildMessage(detail), detail);
        this.detail = detail;
    }

    /**
     * 冲突明细。
     *
     * @return 明细对象
     */
    public SynonymConflictDetail detail() {
        return detail;
    }

    /**
     * 拼人类可读提示。
     *
     * <p>规范词缺失时降级为「其他术语组」而不是拼出一个 {@code null} 字样——
     * 日志与提示里出现 {@code null} 永远只会制造工单。
     *
     * @param detail 冲突明细，可为 {@code null}
     * @return 提示文案
     */
    private static String buildMessage(SynonymConflictDetail detail) {
        if (detail == null || detail.term() == null) {
            return KbResultCode.KB_SYNONYM_TERM_CONFLICT.getMessage();
        }
        String owner = detail.ownerCanonicalTerm() != null && !detail.ownerCanonicalTerm().isBlank()
                ? "「" + detail.ownerCanonicalTerm() + "」"
                : "其他术语组";
        return "「" + detail.term() + "」已属于术语组" + owner + "（已停用的术语组同样占用）";
    }
}
