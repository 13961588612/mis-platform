package com.mis.kb.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * kb_qa_message.role 列宽回归单测。
 *
 * <p>背景：V12__kb_schema.sql 中 kb_qa_message.role 被定义为 VARCHAR(8)，
 * 而合法枚举值 {@code assistant} 长度为 9，导致运行时 INSERT assistant 消息
 * 报「值过长」失败。修复方式为追加迁移
 * V16__kb_qa_message_role_width.sql 将列扩至 VARCHAR(16)。
 *
 * <p>本单测不依赖数据库，仅从枚举侧守护「所有 role 取值必须能被
 * VARCHAR(16) 容纳」这一契约：若将来有人新增超长枚举值而忘记同步扩列，
 * 测试会先于运行时失败。
 */
@DisplayName("QaRole 列宽契约（kb_qa_message.role VARCHAR(16)）")
class QaRoleWidthTest {

    /** 与 V16__kb_qa_message_role_width.sql 中 ALTER COLUMN role TYPE VARCHAR(16) 保持一致。 */
    private static final int ROLE_COLUMN_LENGTH = 16;

    /** 修复前的列宽，用于锁定回归场景。 */
    private static final int LEGACY_ROLE_COLUMN_LENGTH = 8;

    @Test
    @DisplayName("所有 QaRole.code() 长度均不超过 VARCHAR(16)")
    void allRoleCodesFitInColumn() {
        for (QaRole role : QaRole.values()) {
            String code = role.code();
            assertTrue(
                    code.length() <= ROLE_COLUMN_LENGTH,
                    () -> "QaRole." + role.name() + " 的 code=\"" + code + "\" 长度为 "
                            + code.length() + "，超出 kb_qa_message.role 的 VARCHAR("
                            + ROLE_COLUMN_LENGTH + ") 列宽，请追加迁移扩列");
        }
    }

    @Test
    @DisplayName("回归锁定：assistant 超出旧的 VARCHAR(8)，故扩列不可回退")
    void assistantExceedsLegacyColumnWidth() {
        String assistant = QaRole.ASSISTANT.code();

        assertEquals("assistant", assistant);
        assertTrue(
                assistant.length() > LEGACY_ROLE_COLUMN_LENGTH,
                "assistant 应当超出旧列宽 VARCHAR(8)，这是本次 Bug 的根因");
        assertTrue(
                assistant.length() <= ROLE_COLUMN_LENGTH,
                "assistant 必须能被扩列后的 VARCHAR(16) 容纳");
    }

    @Test
    @DisplayName("user 与 assistant 均为合法取值且长度合规")
    void validRoleCodesAreRecognizedAndFit() {
        assertTrue(QaRole.isValid("user"));
        assertTrue(QaRole.isValid("assistant"));

        assertEquals(4, QaRole.USER.code().length());
        assertEquals(9, QaRole.ASSISTANT.code().length());
    }

    @Test
    @DisplayName("非法取值不被识别，避免脏值绕过枚举写库")
    void invalidRoleCodesAreRejected() {
        assertTrue(!QaRole.isValid(null));
        assertTrue(!QaRole.isValid(""));
        assertTrue(!QaRole.isValid("Assistant"));
        assertTrue(!QaRole.isValid("system"));
    }
}
