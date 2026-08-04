package com.mis.kb.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 词条归一化单测（Wave D，<b>主理人裁决 U4 的验收载体</b>）。
 *
 * <p>U4 推翻了设计文档 §8.1 的原口径，改为
 * {@code trim → NFKC → toLowerCase(Locale.ROOT)}。这条改动的价值全在边界上：
 * 折叠什么、<b>不</b>折叠什么，必须逐条钉死，否则半年后有人「顺手」加一个
 * {@code Form.NFKD} 或换个 {@code Locale}，唯一约束的语义就悄悄变了 ——
 * 而 {@code term_norm} 是数据库 {@code uk_synonym_term_norm} 唯一索引的载体，
 * 语义一变，历史数据的唯一性判定全部作废。
 */
class SynonymTermNormalizerTest {

    // ------------------------------------------------------------ 折叠：必须做

    @Nested
    @DisplayName("必须折叠的情形")
    class MustFold {

        @Test
        @DisplayName("全角字母折叠为半角，并统一小写：ＯＫＲ == OKR == okr")
        void fullWidthLatinFolds() {
            String fullWidth = SynonymTermNormalizer.normalize("ＯＫＲ");
            String halfWidthUpper = SynonymTermNormalizer.normalize("OKR");
            String halfWidthLower = SynonymTermNormalizer.normalize("okr");

            assertEquals("okr", fullWidth, "NFKC 必须把全角拉丁字母折成半角，再统一小写");
            assertEquals(halfWidthUpper, fullWidth);
            assertEquals(halfWidthLower, fullWidth);
        }

        @Test
        @DisplayName("全角数字折叠为半角：１２３ == 123")
        void fullWidthDigitsFold() {
            assertEquals("123", SynonymTermNormalizer.normalize("１２３"));
            assertEquals(
                    SynonymTermNormalizer.normalize("123"),
                    SynonymTermNormalizer.normalize("１２３"));
        }

        @Test
        @DisplayName("首尾空白（含全角空格 U+3000）被清除：\" OKR \" → \"okr\"")
        void trimsWhitespaceIncludingIdeographicSpace() {
            assertEquals("okr", SynonymTermNormalizer.normalize(" OKR "));
            assertEquals("okr", SynonymTermNormalizer.normalize("\u3000OKR\u3000"),
                    "全角空格经 NFKC 折成半角空格，必须再 trim 一次才干净");
            assertEquals("okr", SynonymTermNormalizer.normalize("\t OKR \n"));
        }

        @Test
        @DisplayName("大小写混排统一小写：oKr == OkR")
        void caseIsFolded() {
            assertEquals(
                    SynonymTermNormalizer.normalize("oKr"),
                    SynonymTermNormalizer.normalize("OkR"));
        }

        @Test
        @DisplayName("兼容字符折叠：全角括号与半角括号归一")
        void compatibilityCharactersFold() {
            // NFKC 把全角圆括号 U+FF08/U+FF09 折成 ASCII 括号
            assertEquals("(a)", SynonymTermNormalizer.normalize("（Ａ）"));
        }
    }

    // ------------------------------------------------------------ 折叠：明确不做

    @Nested
    @DisplayName("明确不折叠的情形（是既定行为，不是缺陷）")
    class MustNotFold {

        @Test
        @DisplayName("繁简不折叠：軟體 != 软件")
        void traditionalAndSimplifiedStayDistinct() {
            assertNotEquals(
                    SynonymTermNormalizer.normalize("軟體"),
                    SynonymTermNormalizer.normalize("软件"),
                    "繁简折叠需额外词表且会改变唯一约束语义，明确不在 Wave D 范围内；"
                            + "两者若要互为同义词，请录成同一个术语组");
        }

        @Test
        @DisplayName("词内空格不被压缩：\"a b\" 仍是三个字符")
        void innerWhitespaceKept() {
            assertEquals("a b", SynonymTermNormalizer.normalize("  A B  "));
        }
    }

    // ------------------------------------------------------------ 契约

    @Nested
    @DisplayName("契约：幂等 / 空值 / 短词门槛")
    class Contract {

        @Test
        @DisplayName("null 与空白串返回空串，不返回 null")
        void nullAndBlankYieldEmptyString() {
            assertEquals("", SynonymTermNormalizer.normalize(null));
            assertEquals("", SynonymTermNormalizer.normalize(""));
            assertEquals("", SynonymTermNormalizer.normalize("   "));
            assertEquals("", SynonymTermNormalizer.normalize("\u3000"));
        }

        @Test
        @DisplayName("幂等：normalize(normalize(x)) == normalize(x)")
        void idempotent() {
            for (String raw : new String[]{"ＯＫＲ", " OKR ", "軟體", "１２３", "IT-部门", "a b"}) {
                String once = SynonymTermNormalizer.normalize(raw);
                assertEquals(once, SynonymTermNormalizer.normalize(once),
                        "归一化必须幂等，否则 term_norm 会随重跑漂移：" + raw);
            }
        }

        @Test
        @DisplayName("tooShort：按归一化后的长度判定")
        void tooShortUsesNormalizedLength() {
            assertTrue(SynonymTermNormalizer.tooShort(
                    SynonymTermNormalizer.normalize("ＩＴ"), 3));
            assertFalse(SynonymTermNormalizer.tooShort(
                    SynonymTermNormalizer.normalize("ＩＴ"), 2));
            assertTrue(SynonymTermNormalizer.tooShort(null, 1));
            assertTrue(SynonymTermNormalizer.tooShort("", 1));
        }
    }

    // ------------------------------------------------------------ 词边界

    @Nested
    @DisplayName("ASCII 词判定与词边界（D6-3：IT 不得命中 WITH）")
    class WordBoundary {

        @Test
        @DisplayName("isAsciiWord：字母/数字/下划线/连字符为真，含中文为假")
        void asciiWordDetection() {
            assertTrue(SynonymTermNormalizer.isAsciiWord("it"));
            assertTrue(SynonymTermNormalizer.isAsciiWord("okr-2024"));
            assertTrue(SynonymTermNormalizer.isAsciiWord("api_key"));
            assertFalse(SynonymTermNormalizer.isAsciiWord("it部门"));
            assertFalse(SynonymTermNormalizer.isAsciiWord("请假"));
            assertFalse(SynonymTermNormalizer.isAsciiWord(""));
            assertFalse(SynonymTermNormalizer.isAsciiWord(null));
        }

        @Test
        @DisplayName("boundaryOk：WITH 中间的 IT 不满足边界")
        void insideAnotherWordFails() {
            String text = "WITH 语句怎么写";
            assertFalse(SynonymTermNormalizer.boundaryOk(text, 1, 3),
                    "IT 落在 W 与 H 之间，两侧都是 ASCII 词字符，必须判否");
        }

        @Test
        @DisplayName("boundaryOk：独立成词的 IT 满足边界（含句首、句尾、标点相邻）")
        void standaloneWordPasses() {
            assertTrue(SynonymTermNormalizer.boundaryOk("IT 部门在哪", 0, 2));
            assertTrue(SynonymTermNormalizer.boundaryOk("问一下 IT", 4, 6));
            assertTrue(SynonymTermNormalizer.boundaryOk("(IT)", 1, 3));
            assertTrue(SynonymTermNormalizer.boundaryOk("IT部门在哪", 0, 2),
                    "中文字符不属于 ASCII 词字符，紧邻中文仍算边界成立");
        }

        @Test
        @DisplayName("boundaryOk：连字符与下划线算词字符，视为未越界")
        void hyphenAndUnderscoreAreWordChars() {
            assertFalse(SynonymTermNormalizer.boundaryOk("x-IT", 2, 4));
            assertFalse(SynonymTermNormalizer.boundaryOk("IT_x", 0, 2));
        }

        @Test
        @DisplayName("boundaryOk：非法区间一律判否，不抛异常")
        void illegalRangeIsFalse() {
            assertFalse(SynonymTermNormalizer.boundaryOk(null, 0, 1));
            assertFalse(SynonymTermNormalizer.boundaryOk("abc", -1, 2));
            assertFalse(SynonymTermNormalizer.boundaryOk("abc", 1, 9));
            assertFalse(SynonymTermNormalizer.boundaryOk("abc", 2, 2));
        }
    }
}
