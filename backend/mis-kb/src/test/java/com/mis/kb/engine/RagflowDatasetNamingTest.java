package com.mis.kb.engine;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * RAGFlow dataset 命名规范单测（引擎删除策略 P0 / T02 验收点 1）。
 *
 * <p>覆盖任务书要求的四类场景：正常拼接、超长只截库名段、归档前缀幂等、非法字符替换。
 * 外加对账依赖的 {@code isArchivedName} 判定——它一旦误判，已归档库每天都会被对账
 * 判成「名称漂移」，报告里长期一片黄，真正的漂移反而被淹没。
 *
 * <p>本类是纯静态工具测试，无 Mock、无 IO，属于最该有却在 P0 提交里缺失的一块覆盖。
 */
@DisplayName("T02 RAGFlow dataset 命名规范")
class RagflowDatasetNamingTest {

    private static final long LIBRARY_ID = 1_954_321_987_654_321L;

    @Nested
    @DisplayName("forCreate：{一级分类名}-{库名}-{ID后6位}")
    class ForCreate {

        @Test
        @DisplayName("正常拼接：三段齐全且 ID 取后 6 位")
        void shouldJoinThreeSegments() {
            String name = RagflowDatasetNaming.forCreate("财务", "报销制度", LIBRARY_ID);

            assertEquals("财务-报销制度-654321", name);
        }

        @Test
        @DisplayName("ID 不足 6 位时左补 0，保证定长便于肉眼比对")
        void shouldPadShortId() {
            assertEquals("财务-报销制度-000123", RagflowDatasetNaming.forCreate("财务", "报销制度", 123L));
        }

        @Test
        @DisplayName("分类名为空/空白时回落「未分类」")
        void shouldFallbackCategory() {
            assertEquals("未分类-报销制度-000001", RagflowDatasetNaming.forCreate(null, "报销制度", 1L));
            assertEquals("未分类-报销制度-000001", RagflowDatasetNaming.forCreate("   ", "报销制度", 1L));
        }

        @Test
        @DisplayName("库名为空时回落「未命名」，不产生 `分类--123456` 这种空段")
        void shouldFallbackLibraryName() {
            assertEquals("财务-未命名-000001", RagflowDatasetNaming.forCreate("财务", null, 1L));
        }

        @Test
        @DisplayName("超长：只截库名段，分类前缀与 ID 后 6 位一字不动")
        void shouldTruncateOnlyLibrarySegment() {
            String longLibraryName = "库".repeat(300);

            String name = RagflowDatasetNaming.forCreate("财务", longLibraryName, LIBRARY_ID);

            assertEquals(RagflowDatasetNaming.MAX_DATASET_NAME, name.length(),
                    "超长时必须恰好截到上限");
            assertTrue(name.startsWith("财务-"), "一级分类前缀不可截");
            assertTrue(name.endsWith("-654321"), "ID 后 6 位不可截——它是反查回 MIS 的唯一锚点");
            // 中段全部是库名，且确实被截短了
            String middle = name.substring("财务-".length(), name.length() - "-654321".length());
            assertEquals("库".repeat(RagflowDatasetNaming.MAX_DATASET_NAME - 3 - 7), middle);
        }

        @Test
        @DisplayName("极端超长：分类名自己吃光预算时也得让路，但 ID 后缀仍保住")
        void shouldKeepIdSuffixWhenCategoryItselfOverflows() {
            String name = RagflowDatasetNaming.forCreate("类".repeat(200), "报销制度", LIBRARY_ID);

            assertTrue(name.length() <= RagflowDatasetNaming.MAX_DATASET_NAME);
            assertTrue(name.endsWith("654321"), "ID 后 6 位是最后的锚点，任何情况下不能丢");
        }

        @Test
        @DisplayName("不超长时长度自然小于上限（防止把正常名字也截了）")
        void shouldNotTruncateNormalName() {
            String name = RagflowDatasetNaming.forCreate("人力资源", "员工手册", 987_654L);

            assertEquals("人力资源-员工手册-987654", name);
            assertTrue(name.length() < RagflowDatasetNaming.MAX_DATASET_NAME);
        }
    }

    @Nested
    @DisplayName("forArchive：[已归档-yyyyMMdd]-{原名}")
    class ForArchive {

        @Test
        @DisplayName("首次归档：加日期前缀")
        void shouldPrefixArchiveTag() {
            String archived = RagflowDatasetNaming.forArchive(
                    "财务-报销制度-654321", LocalDate.of(2026, 8, 11));

            assertEquals("[已归档-20260811]-财务-报销制度-654321", archived);
        }

        @Test
        @DisplayName("幂等：对已归档名再归档不叠加第二层前缀")
        void shouldBeIdempotent() {
            String once = RagflowDatasetNaming.forArchive(
                    "财务-报销制度-654321", LocalDate.of(2026, 8, 11));

            String twice = RagflowDatasetNaming.forArchive(once, LocalDate.of(2026, 9, 30));

            assertEquals(once, twice, "重试归档不得产生 [已归档-x]-[已归档-y]-... 的滚雪球");
        }

        @Test
        @DisplayName("幂等判定认的是「合法日期前缀」，形似但非法的前缀仍会被再归档")
        void shouldNotTreatMalformedPrefixAsArchived() {
            String result = RagflowDatasetNaming.forArchive("[已归档]-财务库", LocalDate.of(2026, 8, 11));

            assertEquals("[已归档-20260811]-[已归档]-财务库", result);
        }

        @Test
        @DisplayName("date 为 null 时取今天，仍是合法归档名")
        void shouldDefaultToToday() {
            String archived = RagflowDatasetNaming.forArchive("财务-报销制度-654321", null);

            assertTrue(RagflowDatasetNaming.isArchivedName(archived));
        }

        @Test
        @DisplayName("超长：只截原名段，归档前缀不可截")
        void shouldTruncateOnlyBaseSegment() {
            String archived = RagflowDatasetNaming.forArchive(
                    "库".repeat(300), LocalDate.of(2026, 8, 11));

            assertEquals(RagflowDatasetNaming.MAX_DATASET_NAME, archived.length());
            assertTrue(archived.startsWith("[已归档-20260811]-"), "归档前缀截了就认不出这是归档库");
        }

        @Test
        @DisplayName("空原名回落「未命名」，不产出裸前缀")
        void shouldFallbackBlankName() {
            assertEquals("[已归档-20260811]-未命名",
                    RagflowDatasetNaming.forArchive("   ", LocalDate.of(2026, 8, 11)));
        }
    }

    @Nested
    @DisplayName("isArchivedName：对账用的归档判定")
    class IsArchivedName {

        @Test
        @DisplayName("合法归档名识别为 true（含首尾空白）")
        void shouldDetectArchived() {
            assertTrue(RagflowDatasetNaming.isArchivedName("[已归档-20260811]-财务-报销制度-654321"));
            assertTrue(RagflowDatasetNaming.isArchivedName("  [已归档-20260101]-x  "));
        }

        @Test
        @DisplayName("普通名 / null / 日期位数不对 一律 false")
        void shouldRejectNonArchived() {
            assertFalse(RagflowDatasetNaming.isArchivedName(null));
            assertFalse(RagflowDatasetNaming.isArchivedName("财务-报销制度-654321"));
            assertFalse(RagflowDatasetNaming.isArchivedName("[已归档-2026081]-财务库"));
            assertFalse(RagflowDatasetNaming.isArchivedName("前缀不在开头[已归档-20260811]-x"));
        }
    }

    @Nested
    @DisplayName("sanitize：非法字符替换")
    class Sanitize {

        @ParameterizedTest(name = "[{index}] {0} → {1}")
        @CsvSource(value = {
                "a/b, a-b",
                "a\\b, a-b",
                "a:b, a-b",
                "a*b, a-b",
                "a?b, a-b",
                "a<b>c, a-b-c",
                "a|b, a-b",
        })
        @DisplayName("九类非法字符统一替换为 -")
        void shouldReplaceIllegalChars(String raw, String expected) {
            assertEquals(expected, RagflowDatasetNaming.sanitize(raw));
        }

        @Test
        @DisplayName("双引号同样被替换（CsvSource 不便表达，单列一条）")
        void shouldReplaceDoubleQuote() {
            assertEquals("a-b", RagflowDatasetNaming.sanitize("a\"b"));
        }

        @Test
        @DisplayName("首尾空白压掉，换行/制表等控制字符替换为 -")
        void shouldTrimAndDropControlChars() {
            assertEquals("财务库", RagflowDatasetNaming.sanitize("  财务库  "));
            assertEquals("财务-库", RagflowDatasetNaming.sanitize("财务\n库"));
            assertEquals("财务-库", RagflowDatasetNaming.sanitize("财务\t库"));
        }

        @Test
        @DisplayName("null 入参返回空串而非 NPE（调用方靠这个回落默认名）")
        void shouldReturnEmptyForNull() {
            assertEquals("", RagflowDatasetNaming.sanitize(null));
        }

        @Test
        @DisplayName("非法字符会随拼接一起进入 forCreate 结果")
        void shouldSanitizeInsideForCreate() {
            assertEquals("财-务-报销-制度-000001",
                    RagflowDatasetNaming.forCreate("财/务", "报销:制度", 1L));
        }
    }

    @Nested
    @DisplayName("idSuffix")
    class IdSuffix {

        @Test
        @DisplayName("长 ID 取后 6 位，短 ID 左补 0，负 ID 取绝对值")
        void shouldFormatSuffix() {
            assertEquals("654321", RagflowDatasetNaming.idSuffix(LIBRARY_ID));
            assertEquals("000042", RagflowDatasetNaming.idSuffix(42L));
            assertEquals("000042", RagflowDatasetNaming.idSuffix(-42L));
            assertEquals("000000", RagflowDatasetNaming.idSuffix(0L));
        }
    }
}
