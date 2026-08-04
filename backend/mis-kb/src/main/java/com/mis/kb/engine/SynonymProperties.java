package com.mis.kb.engine;

import com.mis.kb.domain.model.SynonymBudget;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 同义词扩展配置（Wave D，Nacos {@code mis.kb.synonym.*}）。
 *
 * <p><b>{@link #enabled} 的语义是「运维熔断闸（kill-switch）」</b>（Q2 裁决），
 * 与库内 {@code kb_synonym_config.enabled} 是<b>双闸</b>关系：<b>任一为 false 即不扩展</b>。
 * 本项<b>页面不可写</b>，S-07 只把它作为只读状态展示（熔断时开关置灰 + 只读说明）。
 *
 * <p><b>预算三值仅 Nacos 可调</b>（Q5）：{@link #maxGroups} / {@link #maxTermsPerGroup} /
 * {@link #maxQueryChars} 与 {@link #minTermLength} 随 {@code GET /synonyms/config} 下发给前端，
 * 前端所有提示文案的数字都从这里取，不许写死。
 *
 * <p>零新增 Maven 依赖：本类只用 Spring Boot 既有的 {@code @ConfigurationProperties}。
 */
@ConfigurationProperties(prefix = "mis.kb.synonym")
public class SynonymProperties {

    /**
     * 运维熔断闸。默认 {@code true}。
     *
     * <p>置 false 时全平台立即停止同义词扩展，词表数据一条不动
     * （{@code SynonymExpansion.status = DISABLED_GLOBAL}）。
     */
    private boolean enabled = true;

    /** 单次最多扩展的术语组数（D6 约束 2）。 */
    private int maxGroups = SynonymBudget.DEFAULT_MAX_GROUPS;

    /** 单组最多并入的别名数（D6 约束 2）。 */
    private int maxTermsPerGroup = SynonymBudget.DEFAULT_MAX_TERMS_PER_GROUP;

    /** 扩展后查询串的字符硬上限（D6 约束 2）。 */
    private int maxQueryChars = SynonymBudget.DEFAULT_MAX_QUERY_CHARS;

    /** 参与自动匹配的最小词长（D6 约束 3）。 */
    private int minTermLength = SynonymBudget.DEFAULT_MIN_TERM_LENGTH;

    /**
     * L2 轮询间隔（毫秒），默认 3000。
     *
     * <p>这是 Q7「问答链路约 3 秒内全平台生效」这句承诺的<b>唯一</b>数值来源。
     * 调大它就等于改口径，改前请同步改前端文案。
     */
    private long refreshIntervalMs = 3000L;

    /** 单次导入允许的最大术语组数，超出即 {@code KB_SYNONYM_IMPORT_TOO_LARGE}。 */
    private int importMaxGroups = 2000;

    /** 单次导入允许的最大文件字节数（默认 2MB），超出即 {@code KB_SYNONYM_IMPORT_TOO_LARGE}。 */
    private long importMaxBytes = 2L * 1024 * 1024;

    /**
     * 容量水位建议线（D6 约束 5，默认 10000 个词条）。
     *
     * <p><b>只做提示，不做阻断</b>：达 80% 与超限各有一档前端文案，后端不拒绝写入。
     */
    private int recommendedTermLimit = 10000;

    /**
     * 引擎原生词表提示位（Q9 裁决）。
     *
     * <p>RAGFlow 的 {@code synonym.json} 是挂进容器的文件，HTTP API 无从探测，
     * 故改为<b>运维声明式开关</b>，默认 false。置 true 时命中测试轨迹追加一行固定提示。
     * 前端<b>必须用 {@code === true} 判定</b>（§7.8，Wave A 的 fail-open 教训）。
     */
    private boolean engineNativeHint = false;

    /**
     * 折算为扩展预算值对象。
     *
     * @return 预算快照（非正数已在 {@link SynonymBudget} 紧凑构造里收敛为默认值）
     */
    public SynonymBudget toBudget() {
        return new SynonymBudget(maxGroups, maxTermsPerGroup, maxQueryChars, minTermLength);
    }

    public boolean isEnabled() {
        return enabled;
    }

    public void setEnabled(boolean enabled) {
        this.enabled = enabled;
    }

    public int getMaxGroups() {
        return maxGroups;
    }

    public void setMaxGroups(int maxGroups) {
        this.maxGroups = maxGroups;
    }

    public int getMaxTermsPerGroup() {
        return maxTermsPerGroup;
    }

    public void setMaxTermsPerGroup(int maxTermsPerGroup) {
        this.maxTermsPerGroup = maxTermsPerGroup;
    }

    public int getMaxQueryChars() {
        return maxQueryChars;
    }

    public void setMaxQueryChars(int maxQueryChars) {
        this.maxQueryChars = maxQueryChars;
    }

    public int getMinTermLength() {
        return minTermLength;
    }

    public void setMinTermLength(int minTermLength) {
        this.minTermLength = minTermLength;
    }

    public long getRefreshIntervalMs() {
        return refreshIntervalMs;
    }

    public void setRefreshIntervalMs(long refreshIntervalMs) {
        this.refreshIntervalMs = refreshIntervalMs;
    }

    public int getImportMaxGroups() {
        return importMaxGroups;
    }

    public void setImportMaxGroups(int importMaxGroups) {
        this.importMaxGroups = importMaxGroups;
    }

    public long getImportMaxBytes() {
        return importMaxBytes;
    }

    public void setImportMaxBytes(long importMaxBytes) {
        this.importMaxBytes = importMaxBytes;
    }

    public int getRecommendedTermLimit() {
        return recommendedTermLimit;
    }

    public void setRecommendedTermLimit(int recommendedTermLimit) {
        this.recommendedTermLimit = recommendedTermLimit;
    }

    public boolean isEngineNativeHint() {
        return engineNativeHint;
    }

    public void setEngineNativeHint(boolean engineNativeHint) {
        this.engineNativeHint = engineNativeHint;
    }
}
