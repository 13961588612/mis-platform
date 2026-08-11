package com.mis.adminbff.audit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.NullNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.node.TextNode;
import com.mis.adminbff.client.AuditWebClient;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.result.Result;
import com.mis.common.security.context.LoginUser;
import com.mis.common.web.audit.OperLog;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collection;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Map.Entry;

@Aspect
@Component
public class OperLogAspect {

    private static final Logger log = LoggerFactory.getLogger(OperLogAspect.class);

    /**
     * 审计参数序列化专用 ObjectMapper。
     *
     * <p>刻意<b>不</b>注入 Spring 容器里那个 ObjectMapper：那个实例承载的是对外 API 的
     * 序列化契约（命名策略、日期格式、@JsonView 等），哪天有人为了改接口输出去调它，
     * 不该顺带改变审计记录的形态。审计要的是「原样、稳定、可长期比对」。
     */
    private static final ObjectMapper MAPPER = new ObjectMapper();

    /**
     * 敏感字段名黑名单（C5-2），<b>归一化后的包含匹配</b>。
     *
     * <p>用「包含」而非「相等」，是因为真实字段名从来不是干净的 {@code password}：
     * {@code userPassword} / {@code oldPwd} / {@code accessToken} / {@code clientSecret}
     * 都得命中。审计侧 {@code OperLogService.maskParams()} 用的是精确键名正则，
     * 覆盖不到这些变体，也覆盖不到非字符串值（{@code "password": 123}）——
     * 所以这一层不是重复劳动，是在<b>源头</b>就不让凭据离开 BFF 进程。
     *
     * <p>片段<b>必须全部小写</b>：{@link #isSensitiveKey(String)} 先把待检字段名
     * 小写 + 剥离非字母数字（{@code private_key} → {@code privatekey}，
     * {@code access-key} → {@code accesskey}，驼峰/蛇形/连字符三种写法同形），
     * 再用归一化后的字符串 {@code contains} 比对。企业级增强一期（Q6 裁决，
     * 技术债 11.5 销账）修复「带分隔符的 {@code private_key} / {@code access-key}
     * 不命中」的盲区；本改动单调变化（只增命中不丢命中），黑名单 7 项不动。
     */
    private static final List<String> SENSITIVE_KEY_FRAGMENTS =
            List.of("password", "pwd", "secret", "token", "credential", "privatekey", "accesskey");

    /**
     * 反例排除清单（误伤修复）：命中黑名单片段但确属合法业务字段的<b>完整归一化名</b>。
     *
     * <p>黑名单用「包含」而非「相等」，必然会把含 {@code token} 片段的业务字段也扫进来。
     * {@code chunkTokenNum} / {@code chunkOverlapTokenNum} 是 RAG 分块参数（每块/重叠
     * 的 token 数），与令牌、凭据毫无关系，审计里必须原样留存。这里用归一化后的
     * <b>精确相等</b>排除，字段名一旦变化就不再豁免——宁可少豁免也不扩大豁免面，
     * 避免真正的 {@code accessToken} 变体漏网。
     */
    private static final java.util.Set<String> SENSITIVE_KEY_EXCLUSIONS =
            java.util.Set.of("chunktokennum", "chunkoverlaptokennum");

    /** 命中黑名单后的替换值。 */
    private static final String MASK = "***";

    /** 单个字符串值的最大留存长度（如命中测试的 question）。 */
    private static final int MAX_STRING_LENGTH = 1000;

    /** 整条 request_params 的最大长度，与审计侧 maskParams 的 4000 上限对齐。 */
    private static final int MAX_PARAMS_LENGTH = 4000;

    /** 从返回体里找结果条数时依次尝试的数组字段名。 */
    private static final List<String> RESULT_COUNT_KEYS =
            List.of("hits", "records", "list", "items", "rows");

    private final AuditWebClient auditWebClient;

    public OperLogAspect(AuditWebClient auditWebClient) {
        this.auditWebClient = auditWebClient;
    }

    @Around("@annotation(operLog)")
    public Object around(ProceedingJoinPoint pjp, OperLog operLog) throws Throwable {
        long start = System.currentTimeMillis();
        Integer responseCode = 0;
        Throwable error = null;
        // T19：结果条数要从返回值里取，故把返回值提升到 try 外，供 finally 读取。
        // 业务异常路径下它保持 null，writeLog 会如实记为「无结果条数」。
        Object result = null;
        try {
            result = pjp.proceed();
            return result;
        } catch (Throwable ex) {
            error = ex;
            responseCode = 1;
            throw ex;
        } finally {
            try {
                writeLog(pjp, operLog, System.currentTimeMillis() - start, responseCode, error, result);
            } catch (Exception ex) {
                // 主理人裁决（企业级增强一期）：审计写失败提升为 WARN，便于运维感知。
                // 仍不影响业务（审计失败绝不阻断主链路，既有语义）。
                log.warn("写操作日志失败: {}", ex.getMessage());
            }
        }
    }

    private void writeLog(
            ProceedingJoinPoint pjp,
            OperLog operLog,
            long durationMs,
            Integer responseCode,
            Throwable error,
            Object result) {
        LoginUser user = null;
        try {
            user = RequestContext.requireLoginUser();
        } catch (Exception ignored) {
            // 无登录上下文时仍尝试记录
        }
        HttpServletRequest request = currentRequest();
        MethodSignature signature = (MethodSignature) pjp.getSignature();
        Map<String, Object> body = new HashMap<>();
        body.put("tenantId", user != null && user.getTenantId() != null ? user.getTenantId() : 0L);
        body.put("userId", user != null ? user.getUserId() : null);
        body.put("username", user != null ? user.getUsername() : null);
        body.put("module", operLog.module());
        body.put("operation", operLog.operation());
        body.put("method", signature.getDeclaringTypeName() + "." + signature.getName());
        body.put("requestUri", request != null ? request.getRequestURI() : null);
        body.put("requestMethod", request != null ? request.getMethod() : null);
        // T19：未开启 recordParams 的端点行为与改造前完全一致——写 null，零变化。
        body.put("requestParams", operLog.recordParams() ? collectParams(pjp, result) : null);
        body.put("responseCode", responseCode);
        body.put("durationMs", (int) Math.min(durationMs, Integer.MAX_VALUE));
        body.put("ip", request != null ? request.getRemoteAddr() : null);
        auditWebClient.createOperLog(body);
    }

    /**
     * 采集入参 + 结果条数，产出可直接落 {@code request_params} 的 JSON 文本。
     *
     * <p>采集的是<b>入参全字段</b>而不是写死某几个业务字段名——通用切面不该认识
     * {@code KbHitTestRequest} 长什么样。对命中测试端点，产出自然就是
     * {@code {libraryId, question, topK, threshold, retrievalMethod, vectorSimilarityWeight,
     * rerank, resultCount}}；调参字段一并留痕反而更有价值：审计要回答的是
     * 「谁用<b>什么参数</b>探了哪个库」，只记问题文本是残缺的。
     *
     * <p>本方法<b>自带兜底</b>：任何异常都吞掉并返回 null。原因是审计记录的主干信息
     * （谁、何时、调了哪个接口）比参数细节重要得多，不能因为某个入参序列化不了
     * （懒加载代理、循环引用、非常规类型）就把整条审计丢了。
     *
     * @param pjp    连接点
     * @param result 业务返回值，可能为 null（异常路径）
     * @return 脱敏截断后的 JSON 文本；无可记录内容或采集失败时返回 {@code null}
     */
    private String collectParams(ProceedingJoinPoint pjp, Object result) {
        try {
            ObjectNode params = MAPPER.createObjectNode();
            MethodSignature signature = (MethodSignature) pjp.getSignature();
            String[] names = signature.getParameterNames();
            Object[] args = pjp.getArgs();
            if (args != null) {
                for (int i = 0; i < args.length; i++) {
                    Object arg = args[i];
                    if (isIgnorableArg(arg)) {
                        continue;
                    }
                    JsonNode sanitized = sanitize(MAPPER.valueToTree(arg));
                    if (sanitized.isObject()) {
                        // 请求体对象平铺到顶层，避免多套一层无意义的 {"body":{...}}
                        params.setAll((ObjectNode) sanitized);
                    } else {
                        // 标量入参（@PathVariable / @RequestParam）：键取形参名。
                        // 形参名本身也要过黑名单——`resetPassword(String newPassword)`
                        // 这种签名，值就直接躺在标量位上，对象级脱敏够不着它。
                        String name = names != null && i < names.length && names[i] != null
                                ? names[i]
                                : "arg" + i;
                        params.set(name, isSensitiveKey(name) ? TextNode.valueOf(MASK) : sanitized);
                    }
                }
            }
            Integer resultCount = extractResultCount(result);
            if (resultCount != null) {
                params.put("resultCount", resultCount);
            }
            if (params.isEmpty()) {
                return null;
            }
            String json = MAPPER.writeValueAsString(params);
            return json.length() > MAX_PARAMS_LENGTH ? json.substring(0, MAX_PARAMS_LENGTH) : json;
        } catch (Exception ex) {
            log.debug("采集审计入参失败，本条审计的 requestParams 记为空: {}", ex.getMessage());
            return null;
        }
    }

    /**
     * 递归脱敏 + 截断。
     *
     * <p>命中黑名单时<b>保留键、只换值</b>：删键会让审计里看不出「这里本来有个密码字段」，
     * 排查时无从判断是没传还是被屏蔽了。
     *
     * @param node 原始节点
     * @return 脱敏后的新节点（不修改入参）
     */
    private static JsonNode sanitize(JsonNode node) {
        if (node == null || node.isNull()) {
            return NullNode.getInstance();
        }
        if (node.isObject()) {
            ObjectNode out = MAPPER.createObjectNode();
            // 用 fields() 而非 2.15 才有的 properties()：这层代码不值得跟 Jackson 版本绑死
            Iterator<Entry<String, JsonNode>> it = node.fields();
            while (it.hasNext()) {
                Entry<String, JsonNode> entry = it.next();
                if (isSensitiveKey(entry.getKey())) {
                    out.put(entry.getKey(), MASK);
                } else {
                    out.set(entry.getKey(), sanitize(entry.getValue()));
                }
            }
            return out;
        }
        if (node.isArray()) {
            ArrayNode out = MAPPER.createArrayNode();
            for (JsonNode child : node) {
                out.add(sanitize(child));
            }
            return out;
        }
        if (node.isTextual()) {
            return TextNode.valueOf(truncate(node.asText()));
        }
        return node;
    }

    /**
     * 字段名是否命中敏感黑名单（归一化包含匹配，Q6 裁决 / 技术债 11.5 销账）。
     *
     * <p>归一化 = 小写 + 剥离所有非字母数字字符（{@code replaceAll("[^a-z0-9]", "")}），
     * 使 {@code private_key} / {@code privateKey} / {@code private-key} 三种写法同形，
     * 全部命中黑名单片段 {@code privatekey}。单调变化：只增命中不丢命中。
     *
     * <p>例外：{@link #SENSITIVE_KEY_EXCLUSIONS} 中的完整归一化名（如
     * {@code chunkTokenNum} / {@code chunkOverlapTokenNum}）即使 contains 命中
     * {@code token} 片段也直接放行——它们是合法业务字段，不得误伤。
     *
     * @param key 字段名
     * @return 命中返回 {@code true}
     */
    private static boolean isSensitiveKey(String key) {
        if (key == null || key.isEmpty()) {
            return false;
        }
        String normalized = key.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
        // 反例排除须先于黑名单判定：归一化精确相等命中即放行，避免误伤业务字段。
        if (SENSITIVE_KEY_EXCLUSIONS.contains(normalized)) {
            return false;
        }
        for (String fragment : SENSITIVE_KEY_FRAGMENTS) {
            if (normalized.contains(fragment)) {
                return true;
            }
        }
        return false;
    }

    /** 超长字符串截断，留存内容不超过 {@value #MAX_STRING_LENGTH} 字符。 */
    private static String truncate(String value) {
        if (value == null || value.length() <= MAX_STRING_LENGTH) {
            return value;
        }
        return value.substring(0, MAX_STRING_LENGTH) + "...(truncated)";
    }

    /**
     * 框架类入参不入审计：既序列化不了，记了也没有信息量。
     *
     * @param arg 入参
     * @return 需要跳过返回 {@code true}
     */
    private static boolean isIgnorableArg(Object arg) {
        return arg == null
                || arg instanceof HttpServletRequest
                || arg instanceof HttpServletResponse
                || arg instanceof MultipartFile
                || arg instanceof MultipartFile[]
                || arg instanceof InputStream
                || arg instanceof OutputStream
                || arg instanceof Throwable;
    }

    /**
     * 从返回值里提取结果条数。
     *
     * <p>依次尝试：{@code Result} 拆包 → 集合直接取 size → JSON 数组取 size →
     * 常见列表字段名（hits/records/list/items/rows）取 size。都不匹配则返回 null，
     * 表示「这个端点没有条数概念」，而不是硬塞个 0 造成误读。
     *
     * @param result 业务返回值
     * @return 结果条数；无法判定时为 {@code null}
     */
    private static Integer extractResultCount(Object result) {
        if (result == null) {
            return null;
        }
        try {
            Object data = result instanceof Result<?> wrapper ? wrapper.getData() : result;
            if (data == null) {
                return null;
            }
            if (data instanceof Collection<?> collection) {
                return collection.size();
            }
            JsonNode node = MAPPER.valueToTree(data);
            if (node == null) {
                return null;
            }
            if (node.isArray()) {
                return node.size();
            }
            for (String key : RESULT_COUNT_KEYS) {
                JsonNode child = node.get(key);
                if (child != null && child.isArray()) {
                    return child.size();
                }
            }
            return null;
        } catch (Exception ex) {
            log.debug("提取审计结果条数失败: {}", ex.getMessage());
            return null;
        }
    }

    private static HttpServletRequest currentRequest() {
        ServletRequestAttributes attrs =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
        return attrs != null ? attrs.getRequest() : null;
    }
}
