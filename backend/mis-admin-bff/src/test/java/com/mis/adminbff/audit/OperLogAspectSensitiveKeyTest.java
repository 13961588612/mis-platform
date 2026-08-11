package com.mis.adminbff.audit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
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
 * <p><b>企业级增强一期（Q6 裁决 / 技术债 11.5 销账）后口径：</b>
 * {@code isSensitiveKey} 采用<b>归一化匹配</b>（小写 + 剥离非字母数字），
 * 使驼峰 / 蛇形 / 连字符三种写法同形（{@code privateKey} / {@code private_key} /
 * {@code private-key} 均归一化为 {@code privatekey}）。因此：
 * <ul>
 *   <li>既有 7 个黑名单片段<b>不动</b>（password/pwd/secret/token/credential/
 *       privatekey/accesskey）；</li>
 *   <li>原「已知盲区」组（蛇形/连字符不命中）断言<b>翻转</b>——现在全部命中；</li>
 *   <li>单调变化只增命中不丢命中，`max_tokens` 类既有过度脱敏与本改动无关；</li>
 *   <li>反向断言锁定正常业务字段（topK/docType/retrievalMethod/question 等）仍不命中。</li>
 * </ul>
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

    // ------------------------------------------------------- privatekey / accesskey 全形态命中

    @ParameterizedTest(name = "[{index}] {0} 应被判定为敏感")
    @ValueSource(strings = {
            // privatekey 片段：驼峰 / 全大写 / 前后缀
            "privatekey", "privateKey", "PrivateKey", "PRIVATEKEY",
            "privateKeyPem", "userPrivateKey", "sshPrivateKeyContent",
            // accesskey 片段
            "accesskey", "accessKey", "AccessKey", "ACCESSKEY",
            "accessKeyId", "aliyunAccessKeySecret", "myACCESSKEYvalue",
            // 11.5 销账：蛇形 / 连字符 / 混合分隔形态全部同形命中
            "private_key", "private-key", "PRIVATE_KEY", "ACCESS-KEY",
            "access_key", "user_private_key", "aliyun_access_key_secret"
    })
    @DisplayName("privatekey / accesskey：驼峰/蛇形/连字符全形态均命中（11.5 销账）")
    void newFragmentsShouldBeDetected(String key) {
        assertTrue(sensitive(key), "字段名 " + key + " 应命中敏感黑名单");
    }

    @ParameterizedTest(name = "[{index}] {0} 应被判定为敏感")
    @ValueSource(strings = {
            "password", "userPassword", "oldPwd", "pwd",
            "clientSecret", "SECRET", "accessToken", "refreshToken",
            "credential", "userCredentials",
            // 既有过度脱敏（含 token 片段）保持不变：单调变化不丢命中
            "max_tokens", "maxTokens"
    })
    @DisplayName("既有黑名单片段不得回归（含 max_tokens 类既有过度脱敏保持不变）")
    void legacyFragmentsShouldStillBeDetected(String key) {
        assertTrue(sensitive(key), "字段名 " + key + " 应命中敏感黑名单");
    }

    // ------------------------------------------------------- 反向断言：正常业务字段不命中

    @ParameterizedTest(name = "[{index}] {0} 不应被判定为敏感")
    @ValueSource(strings = {
            "libraryId", "question", "topK", "threshold",
            "retrievalMethod", "rerank", "keyName", "publicKeyless",
            "docType", "chunkTokenNum", "separator", "scoreThreshold",
            "embeddingModel", "vectorSimilarityWeight", "emptyResultStrategy",
            "ocrEnabled", "ocrLanguage", "chunkOverlapTokenNum",
            "subjectId", "subjectType", "action", "enabled", "onlyFailed"
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
    @DisplayName("sanitize：11.5 销账后蛇形/连字符键同样被脱敏（原盲区闭合）")
    void sanitizeMasksSeparatedForms() {
        JsonNode out = sanitizeJson("""
                {
                  "private_key": "snake-leaked",
                  "access-key": "kebab-leaked",
                  "PRIVATE_KEY": "upper-snake-leaked",
                  "privateKey": "camel-masked"
                }
                """);

        assertEquals("***", out.get("private_key").asText(), "蛇形键 11.5 销账后必须脱敏");
        assertEquals("***", out.get("access-key").asText(), "连字符键 11.5 销账后必须脱敏");
        assertEquals("***", out.get("PRIVATE_KEY").asText(), "全大写蛇形键 11.5 销账后必须脱敏");
        assertEquals("***", out.get("privateKey").asText(), "驼峰键保持既有脱敏");
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
}
