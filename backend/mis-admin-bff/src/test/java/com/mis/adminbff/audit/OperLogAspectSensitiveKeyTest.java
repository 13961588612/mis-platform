package com.mis.adminbff.audit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@code OperLogAspect} 审计脱敏黑名单（C5-2）的回归测试。
 *
 * <p>被测的 {@code isSensitiveKey(String)} 与 {@code sanitize(JsonNode)} 都是
 * {@code private static}，故用反射直接打靶。相比走 {@code around()} 切面
 * （要 mock ProceedingJoinPoint + MethodSignature + AuditWebClient），
 * 反射的信噪比高得多，且本次要验的正是「片段字面量写对没有」这一件事。
 *
 * <p><b>本测试同时固化两件事</b>：
 * <ol>
 *   <li>驼峰形态的 privateKey / accessKey 各种大小写<b>必须</b>被脱敏；</li>
 *   <li>蛇形 {@code private_key} / 连字符 {@code access-key} <b>确实不命中</b>——
 *       这是已在源码注释（第 66-68 行）登记的已知盲区。把它写成断言而不是口头约定，
 *       是为了让将来「补上蛇形片段」这个动作有个明确的失败信号：
 *       届时本组断言会红，改测试的人就必须同步确认技术债是否可以销账。</li>
 * </ol>
 */
class OperLogAspectSensitiveKeyTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static Method isSensitiveKey;
    private static Method sanitize;

    static {
        try {
            isSensitiveKey = OperLogAspect.class.getDeclaredMethod("isSensitiveKey", String.class);
            isSensitiveKey.setAccessible(true);
            sanitize = OperLogAspect.class.getDeclaredMethod("sanitize", JsonNode.class);
            sanitize.setAccessible(true);
        } catch (NoSuchMethodException ex) {
            throw new ExceptionInInitializerError(ex);
        }
    }

    private static boolean sensitive(String key) {
        try {
            return (boolean) isSensitiveKey.invoke(null, key);
        } catch (Exception ex) {
            throw new IllegalStateException("反射调用 isSensitiveKey 失败", ex);
        }
    }

    private static JsonNode sanitizeJson(String json) {
        try {
            return (JsonNode) sanitize.invoke(null, MAPPER.readTree(json));
        } catch (Exception ex) {
            throw new IllegalStateException("反射调用 sanitize 失败", ex);
        }
    }

    // ------------------------------------------------------- 本次新增的两个片段

    @ParameterizedTest(name = "[{index}] {0} 应被判定为敏感")
    @ValueSource(strings = {
            // privatekey 片段的各种大小写与前后缀形态
            "privatekey", "privateKey", "PrivateKey", "PRIVATEKEY",
            "privateKeyPem", "userPrivateKey", "sshPrivateKeyContent",
            // accesskey 片段的各种大小写与前后缀形态
            "accesskey", "accessKey", "AccessKey", "ACCESSKEY",
            "accessKeyId", "aliyunAccessKeySecret", "myACCESSKEYvalue"
    })
    @DisplayName("新增片段 privatekey / accesskey：驼峰与全大小写形态均命中")
    void newFragmentsShouldBeDetected(String key) {
        assertTrue(sensitive(key), "字段名 " + key + " 应命中敏感黑名单");
    }

    @ParameterizedTest(name = "[{index}] {0} 应被判定为敏感")
    @ValueSource(strings = {
            "password", "userPassword", "oldPwd", "pwd",
            "clientSecret", "SECRET", "accessToken", "refreshToken",
            "credential", "userCredentials"
    })
    @DisplayName("既有 5 个片段不得回归")
    void legacyFragmentsShouldStillBeDetected(String key) {
        assertTrue(sensitive(key), "字段名 " + key + " 应命中敏感黑名单");
    }

    @ParameterizedTest(name = "[{index}] {0} 不应被判定为敏感")
    @ValueSource(strings = {
            "libraryId", "question", "topK", "threshold",
            "retrievalMethod", "rerank", "keyName", "publicKeyless"
    })
    @DisplayName("正常业务字段不得误伤（question 是追责证据，必须原样留存）")
    void normalFieldsShouldNotBeDetected(String key) {
        assertFalse(sensitive(key), "字段名 " + key + " 不应被误判为敏感");
    }

    @Test
    @DisplayName("null / 空字符串安全返回 false")
    void nullAndEmptyAreNotSensitive() {
        assertFalse(sensitive(null));
        assertFalse(sensitive(""));
    }

    // ------------------------------------------------------- 端到端脱敏行为

    @Test
    @DisplayName("sanitize：命中键保留键名、值替换为 ***，非命中键原样保留")
    void sanitizeMasksValueButKeepsKey() {
        JsonNode out = sanitizeJson("""
                {
                  "libraryId": 100,
                  "question": "年假怎么休",
                  "privateKey": "-----BEGIN RSA PRIVATE KEY-----",
                  "accessKey": "AKIA1234567890",
                  "AccessKey": "AKIA0987654321",
                  "accessKeyId": "AKIAIDVALUE"
                }
                """);

        assertTrue(out.has("privateKey"), "命中键必须保留，否则审计看不出这里本来有个凭据字段");
        assertEquals("***", out.get("privateKey").asText());
        assertEquals("***", out.get("accessKey").asText());
        assertEquals("***", out.get("AccessKey").asText());
        assertEquals("***", out.get("accessKeyId").asText());

        assertEquals(100, out.get("libraryId").asInt(), "业务字段不得被脱敏");
        assertEquals("年假怎么休", out.get("question").asText(), "question 属追责证据，只截断不脱敏");
    }

    @Test
    @DisplayName("sanitize：非字符串值（数字/对象/数组）命中黑名单同样被屏蔽")
    void sanitizeMasksNonStringValues() {
        JsonNode out = sanitizeJson("""
                {
                  "password": 123456,
                  "accessKey": {"id": "AKIA", "secret": "xyz"},
                  "privateKey": ["line1", "line2"]
                }
                """);

        assertEquals("***", out.get("password").asText(), "数字型密码也必须屏蔽");
        assertEquals("***", out.get("accessKey").asText(), "对象型凭据整体屏蔽，不得逐层下钻泄露");
        assertEquals("***", out.get("privateKey").asText(), "数组型凭据整体屏蔽");
    }

    @Test
    @DisplayName("sanitize：嵌套对象与数组内的敏感键递归脱敏")
    void sanitizeRecursesIntoNestedStructures() {
        JsonNode out = sanitizeJson("""
                {
                  "outer": {
                    "inner": {"privateKey": "pk", "name": "keep"},
                    "list": [{"accessKey": "ak"}, {"plain": "v"}]
                  }
                }
                """);

        assertEquals("***", out.get("outer").get("inner").get("privateKey").asText());
        assertEquals("keep", out.get("outer").get("inner").get("name").asText());
        assertEquals("***", out.get("outer").get("list").get(0).get("accessKey").asText());
        assertEquals("v", out.get("outer").get("list").get(1).get("plain").asText());
    }

    // ------------------------------------------------------- 已登记的已知盲区

    /**
     * 蛇形 / 连字符命名的盲区。
     *
     * <p>这些断言<b>刻意断言「不命中」</b>，用来固化 OperLogAspect 第 66-68 行注释里
     * 登记的已知盲区。它不是「测试通过=安全」，而是「测试通过=现状与登记一致」。
     * 若将来给黑名单补上 {@code private_key} / {@code access-key} 片段，本组断言会失败，
     * 那时应当同步删除本 Nested 类并销掉对应技术债。
     */
    @Nested
    @DisplayName("已知盲区（与源码注释登记一致）")
    class KnownBlindSpots {

        @ParameterizedTest(name = "[{index}] {0} 当前不命中（已登记盲区）")
        @ValueSource(strings = {"private_key", "access-key", "PRIVATE_KEY", "ACCESS-KEY"})
        @DisplayName("带下划线/连字符的分隔形态当前确实不命中")
        void separatedFormsAreCurrentlyMissed(String key) {
            assertFalse(sensitive(key),
                    "若此断言失败，说明黑名单已补上分隔符变体，请同步销账技术债并删除本用例");
        }

        @Test
        @DisplayName("盲区在 sanitize 端到端同样存在：private_key 的值会原样落进审计")
        void blindSpotLeaksThroughSanitize() {
            JsonNode out = sanitizeJson("{\"private_key\":\"SHOULD-BE-MASKED-BUT-ISNT\"}");
            assertEquals("SHOULD-BE-MASKED-BUT-ISNT", out.get("private_key").asText(),
                    "现状：蛇形键未脱敏。这是已登记盲区，不是本次回归引入的新问题");
        }

        @Test
        @DisplayName("对照组：同义驼峰键在同一 payload 里正常脱敏")
        void camelCaseCounterpartIsMasked() {
            JsonNode out = sanitizeJson(
                    "{\"private_key\":\"leaked\",\"privateKey\":\"masked\"}");
            assertEquals("leaked", out.get("private_key").asText());
            assertEquals("***", out.get("privateKey").asText());
        }
    }
}
