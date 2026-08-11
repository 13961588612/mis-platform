package com.mis.kb.domain.model;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;

/**
 * 两级切片合并收口单测（T01 验收，设计 §3.2.2 / §8-5）。
 *
 * <p>必测三态：全空继承（source=LIBRARY）、任一非空文件指定（source=FILE_OVERRIDE）、
 * 生效 = 文件 ?? 库级 ?? 全局默认。空白 chunkMethod 视为未指定（不产生覆盖）。
 */
class DocumentChunkConfigResolverTest {

    private final DocumentChunkConfigResolver resolver = new DocumentChunkConfigResolver();

    private static RagSettings libSettings(String method, Integer token, String sep) {
        return new RagSettings(null, null, null, null, "hybrid",
                method, token, sep, null, null, null).withDefaults();
    }

    @Nested
    @DisplayName("全空文件级 → 继承库级（source=LIBRARY）")
    class Inherit {

        @Test
        @DisplayName("空配置继承库级三字段")
        void emptyFileInheritsLibrary() {
            EffectiveChunkConfig r = resolver.resolve(
                    new DocumentChunkConfig(null, null, null),
                    libSettings("table", 256, "###"));

            assertNotNull(r);
            assertEquals("table", r.chunkMethod());
            assertEquals(256, r.chunkTokenNum());
            assertEquals("###", r.separator());
            assertEquals(EffectiveChunkConfig.SOURCE_LIBRARY, r.source());
        }

        @Test
        @DisplayName("null 文件级 → 同样继承库级")
        void nullFileFallsBackToLibrary() {
            EffectiveChunkConfig r = resolver.resolve(
                    null, libSettings("naive", RagSettings.DEFAULT_CHUNK_TOKEN_NUM, null));

            assertEquals("naive", r.chunkMethod());
            assertEquals(RagSettings.DEFAULT_CHUNK_TOKEN_NUM, r.chunkTokenNum());
            assertEquals(EffectiveChunkConfig.SOURCE_LIBRARY, r.source());
        }

        @Test
        @DisplayName("库级为 null → 回落全局默认")
        void nullLibraryFallsBackToDefaults() {
            EffectiveChunkConfig r = resolver.resolve(
                    new DocumentChunkConfig(null, null, null), null);

            assertEquals(RagSettings.DEFAULT_CHUNK_METHOD, r.chunkMethod());
            assertEquals(RagSettings.DEFAULT_CHUNK_TOKEN_NUM, r.chunkTokenNum());
            assertEquals(EffectiveChunkConfig.SOURCE_LIBRARY, r.source());
        }
    }

    @Nested
    @DisplayName("任一文件级字段非空 → 文件指定（source=FILE_OVERRIDE）")
    class Override {

        @Test
        @DisplayName("文件指定切片方法 → 覆盖库级，未指定字段仍继承库级")
        void methodOverride() {
            EffectiveChunkConfig r = resolver.resolve(
                    new DocumentChunkConfig("paper", null, null),
                    libSettings("naive", RagSettings.DEFAULT_CHUNK_TOKEN_NUM, null));

            assertEquals("paper", r.chunkMethod());
            assertEquals(RagSettings.DEFAULT_CHUNK_TOKEN_NUM, r.chunkTokenNum(), "未指定字段应继承库级");
            assertEquals(EffectiveChunkConfig.SOURCE_FILE_OVERRIDE, r.source());
        }

        @Test
        @DisplayName("文件指定 token 数 → 覆盖库级，方法仍继承")
        void tokenOverride() {
            EffectiveChunkConfig r = resolver.resolve(
                    new DocumentChunkConfig(null, 512, null),
                    libSettings("naive", 128, null));

            assertEquals(512, r.chunkTokenNum());
            assertEquals("naive", r.chunkMethod());
            assertEquals(EffectiveChunkConfig.SOURCE_FILE_OVERRIDE, r.source());
        }

        @Test
        @DisplayName("文件指定分隔符 → 覆盖库级")
        void separatorOverride() {
            EffectiveChunkConfig r = resolver.resolve(
                    new DocumentChunkConfig(null, null, "###"),
                    libSettings("naive", 128, "---"));

            assertEquals("###", r.separator());
            assertEquals(EffectiveChunkConfig.SOURCE_FILE_OVERRIDE, r.source());
        }

        @Test
        @DisplayName("空白 chunkMethod 视为未指定 → 不产生覆盖，source 仍 LIBRARY")
        void blankMethodIsNotOverride() {
            EffectiveChunkConfig r = resolver.resolve(
                    new DocumentChunkConfig("  ", null, null),
                    libSettings("naive", 128, null));

            assertEquals("naive", r.chunkMethod());
            assertEquals(EffectiveChunkConfig.SOURCE_LIBRARY, r.source());
        }
    }
}
