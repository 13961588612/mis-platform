package com.mis.kb.domain.service;

import com.mis.kb.domain.model.GroupEntry;
import com.mis.kb.domain.model.SynonymBudget;
import com.mis.kb.domain.model.SynonymDictionary;
import com.mis.kb.domain.model.SynonymExpansion;
import com.mis.kb.domain.model.SynonymHit;
import com.mis.kb.domain.model.SynonymTermNormalizer;
import com.mis.kb.engine.SynonymProperties;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * 同义词扩展服务 —— <b>扩展逻辑的唯一收口</b>（WD-05）。
 *
 * <p>问答检索与命中测试<b>共用同一份实现、同一份词典</b>。这是 AC-03 的结构性前提：
 * 管理员在命中测试里看到的扩展轨迹，必须与线上问答真实发生的扩展逐字一致，
 * 否则「调参工具」就成了「另一套系统」。
 *
 * <p><b>算法七步（顺序不可换，与设计 §5.2-T05 / §7.4 逐条对应）：</b>
 * <ol>
 *   <li><b>开关判定</b>：{@code properties.enabled && dictLoader.enabled()} 为 false →
 *       {@code DISABLED_GLOBAL}；{@code disabledForThisRun} → {@code DISABLED_REQUEST}。
 *       两者都在扫描<b>之前</b>短路；</li>
 *   <li><b>最长匹配扫描</b>：对每个起点 {@code i}，{@code len} 从
 *       {@code min(maxTermLength, n-i)} 递减到 {@code minTermLength}，命中即取，指针跳到 {@code i+len}；</li>
 *   <li><b>短词过滤</b>：长度 &lt; {@code minTermLength} 的词条不参与匹配；
 *       若它以完整形态出现在问句中，记入 {@code skippedShortTerms}（WD-19 的数据来源）；</li>
 *   <li><b>ASCII 词边界</b>：命中词为纯 ASCII 词时要求 {@code boundaryOk}，
 *       否则丢弃本次命中继续下探 —— 这条挡住的是 {@code IT} 命中 {@code WITH} 中间那两个字母；</li>
 *   <li><b>预算截断</b>：按<b>命中位置先后</b>取前 {@code maxGroups} 组，
 *       每组取 {@code orderedTerms} 前 {@code maxTermsPerGroup + 1} 项（规范词不占别名额度）；</li>
 *   <li><b>装配</b>：<b>就地插入</b>，原问句字符 100% 保留；超 {@code maxQueryChars} 时
 *       <b>按组整组回退</b>（从优先级最低的组开始撤），仅当<b>原问句自身</b>超限才字符级截断；</li>
 *   <li><b>四态收敛</b>：无命中 → {@code NO_MATCH}（必须显式返回，不能返回 null）；
 *       有命中 → {@code EXPANDED}。{@code expandedQuery} 恒非空。</li>
 * </ol>
 *
 * <p><b>⛔ 装配不许用正则替换</b>：问句里的 {@code ?}、{@code (}、{@code +} 都是正则元字符，
 * 用 {@code String.replaceAll} 会直接炸或产生错位。这里全程用 {@link StringBuilder} 按已记录的
 * 匹配区间拼接。
 *
 * <p><b>为什么在原串上按窗口归一化，而不是先把整句归一化：</b>NFKC 可能改变字符串长度
 * （如 {@code ﬁ → fi}），整句归一化后再回填位置需要维护一张下标映射表，多一处出错点。
 * 逐窗口 {@code normalize(substring)} 的语义与词条入库时完全一致，且位置天然对齐原串。
 */
@Service
public class SynonymExpandService {

    private static final Logger log = LoggerFactory.getLogger(SynonymExpandService.class);

    /** 就地插入的左括号（全角，避免与问句中常见的半角括号混淆）。 */
    private static final char OPEN = '（';
    /** 就地插入的右括号。 */
    private static final char CLOSE = '）';
    /** 扩展词之间的分隔符。 */
    private static final char SEP = ' ';

    private final SynonymDictLoader dictLoader;
    private final SynonymProperties properties;

    public SynonymExpandService(SynonymDictLoader dictLoader, SynonymProperties properties) {
        this.dictLoader = dictLoader;
        this.properties = properties;
    }

    // ---------------------------------------------------------------- 公开 API

    /**
     * 扩展（<b>热路径</b>）：使用当前内存快照，<b>不做任何数据库查询</b>。
     *
     * @param question           用户原话
     * @param disabledForThisRun 本次请求是否显式关闭扩展
     * @return 扩展结果，恒非 {@code null}
     */
    public SynonymExpansion expand(String question, boolean disabledForThisRun) {
        return doExpand(question, disabledForThisRun, dictLoader.current());
    }

    /**
     * 强一致扩展（<b>仅命中测试调用</b>）：先 {@code ensureFresh()} 同步校验词表版本再扩展。
     *
     * <p>这是 Q7「已保存，可立即在命中测试中验证」的兑现点。
     *
     * @param question           用户原话
     * @param disabledForThisRun 本次请求是否显式关闭扩展
     * @return 扩展结果，恒非 {@code null}
     */
    public SynonymExpansion expandFresh(String question, boolean disabledForThisRun) {
        return doExpand(question, disabledForThisRun, dictLoader.ensureFresh());
    }

    // ---------------------------------------------------------------- 主流程

    private SynonymExpansion doExpand(
            String question, boolean disabledForThisRun, SynonymDictionary dict) {
        String original = question == null ? "" : question;
        SynonymBudget budget = properties.toBudget();
        boolean hint = properties.isEngineNativeHint();

        // 步骤 1：开关判定（双闸，Q2）。全局闸优先于单次请求 ——
        // 全局关时管理员的下一步动作是「去改开关」，比「取消勾选」更重要，不能被后者掩盖。
        if (!properties.isEnabled() || !dictLoader.enabled()) {
            return SynonymExpansion.disabled(
                    SynonymExpansion.STATUS_DISABLED_GLOBAL, original, budget, hint);
        }
        if (disabledForThisRun) {
            return SynonymExpansion.disabled(
                    SynonymExpansion.STATUS_DISABLED_REQUEST, original, budget, hint);
        }
        if (original.isBlank() || dict == null || dict.isEmpty()) {
            return SynonymExpansion.noMatch(original, budget, List.of(), hint);
        }

        // 步骤 2-4：扫描
        ScanResult scan = longestMatchScan(original, dict, budget);
        if (scan.matches().isEmpty()) {
            return SynonymExpansion.noMatch(original, budget, scan.skippedShortTerms(), hint);
        }

        // 步骤 5-6：预算截断 + 装配
        return assemble(original, dict, budget, scan, hint);
    }

    // ---------------------------------------------------------------- 步骤 2-4

    /**
     * 最长匹配扫描。
     *
     * <p>同一个术语组在一句话里出现多次时只取<b>第一次</b>命中：重复插入同一组别名
     * 只会线性放大查询串长度，对召回没有增益。
     *
     * @param text   原问句
     * @param dict   词典快照
     * @param budget 预算（提供 {@code minTermLength}）
     * @return 命中区间列表（按位置升序、互不重叠）+ 被跳过的短词
     */
    private ScanResult longestMatchScan(String text, SynonymDictionary dict, SynonymBudget budget) {
        List<Match> matches = new ArrayList<>();
        Set<Long> seenGroups = new LinkedHashSet<>();
        Set<String> skippedShort = new LinkedHashSet<>();

        int n = text.length();
        int windowMax = Math.max(1, dict.maxTermLength());
        int minLen = Math.max(1, budget.minTermLength());

        int i = 0;
        while (i < n) {
            if (Character.isWhitespace(text.charAt(i))) {
                i++;
                continue;
            }
            int maxLen = Math.min(windowMax, n - i);
            Match hit = null;
            // 最长优先：从长到短试探，命中即停
            for (int len = maxLen; len >= minLen; len--) {
                Match candidate = tryMatch(text, i, i + len, dict);
                if (candidate != null) {
                    hit = candidate;
                    break;
                }
            }
            if (hit != null) {
                if (seenGroups.add(hit.groupId())) {
                    matches.add(hit);
                }
                i = hit.end();
                continue;
            }
            // 步骤 3：短词探测。只在 [1, minLen) 区间试一次，代价是 O(minTermLength)，可忽略。
            // 命中的短词不参与扩展，但要如实回传给命中测试轨迹（WD-19），
            // 否则管理员会以为「我录的 IT 怎么没生效」而反复重录。
            for (int len = Math.min(minLen - 1, n - i); len >= 1; len--) {
                Match shortHit = tryMatch(text, i, i + len, dict);
                if (shortHit != null) {
                    skippedShort.add(shortHit.matchedTerm());
                    break;
                }
            }
            i++;
        }
        return new ScanResult(matches, new ArrayList<>(skippedShort));
    }

    /**
     * 试探单个窗口是否命中词典。
     *
     * @param text  原问句
     * @param start 窗口起点（含）
     * @param end   窗口终点（不含）
     * @param dict  词典快照
     * @return 命中则返回 {@link Match}，否则 {@code null}
     */
    private Match tryMatch(String text, int start, int end, SynonymDictionary dict) {
        // 窗口首尾是空白时跳过：normalize() 会 trim 掉它们，导致「命中区间」与「实际词」错位
        if (Character.isWhitespace(text.charAt(start)) || Character.isWhitespace(text.charAt(end - 1))) {
            return null;
        }
        String surface = text.substring(start, end);
        String norm = SynonymTermNormalizer.normalize(surface);
        if (norm.isEmpty()) {
            return null;
        }
        Long groupId = dict.lookup(norm);
        if (groupId == null) {
            return null;
        }
        // 步骤 4：ASCII 词才校验边界；中文不设边界（否则「请假流程」里的「请假」永远匹配不上）
        if (SynonymTermNormalizer.isAsciiWord(norm)
                && !SynonymTermNormalizer.boundaryOk(text, start, end)) {
            return null;
        }
        return new Match(start, end, groupId, surface, norm);
    }

    // ---------------------------------------------------------------- 步骤 5-6

    /**
     * 预算截断 + 就地装配。
     *
     * @param original 原问句
     * @param dict     词典快照
     * @param budget   预算
     * @param scan     扫描结果
     * @param hint     引擎原生词表提示位
     * @return 扩展结果
     */
    private SynonymExpansion assemble(
            String original,
            SynonymDictionary dict,
            SynonymBudget budget,
            ScanResult scan,
            boolean hint) {

        List<Match> all = scan.matches();
        int totalMatchedGroups = all.size();
        List<String> dropped = new ArrayList<>();

        // 5.1 组数截断：按命中位置先后取前 N 组，其余整组丢弃
        List<Match> picked = new ArrayList<>(Math.min(all.size(), budget.maxGroups()));
        for (int k = 0; k < all.size(); k++) {
            if (k < budget.maxGroups()) {
                picked.add(all.get(k));
            } else {
                dropped.add(groupLabel(dict, all.get(k)));
            }
        }

        // 6.1 原问句自身即超字符预算：此时本就没有扩展空间，唯一允许发生字符级截断的场景
        if (original.length() > budget.maxQueryChars()) {
            for (Match m : picked) {
                dropped.add(groupLabel(dict, m));
            }
            String cut = original.substring(0, budget.maxQueryChars());
            log.warn("原问句长度 {} 超出 maxQueryChars={}，已字符级截断且本次不做同义词扩展",
                    original.length(), budget.maxQueryChars());
            return new SynonymExpansion(
                    SynonymExpansion.STATUS_EXPANDED, original, cut,
                    List.of(), dropped, scan.skippedShortTerms(),
                    totalMatchedGroups, 0, true, hint, budget);
        }

        // 6.2 逐组回退直到不超字符预算：从优先级最低（命中位置最靠后）的组开始整组撤
        boolean truncatedByChars = false;
        Assembled assembled = build(original, dict, budget, picked);
        while (assembled.query().length() > budget.maxQueryChars() && !picked.isEmpty()) {
            Match removed = picked.remove(picked.size() - 1);
            dropped.add(groupLabel(dict, removed));
            truncatedByChars = true;
            assembled = build(original, dict, budget, picked);
        }

        boolean truncated = truncatedByChars || dropped.size() > 0;
        if (truncated) {
            log.debug("同义词扩展发生截断 totalMatched={} used={} dropped={}",
                    totalMatchedGroups, picked.size(), dropped);
        }
        return new SynonymExpansion(
                SynonymExpansion.STATUS_EXPANDED,
                original,
                assembled.query(),
                assembled.hits(),
                dropped,
                scan.skippedShortTerms(),
                totalMatchedGroups,
                picked.size(),
                truncated,
                hint,
                budget);
    }

    /**
     * 就地插入装配：{@code 原词（别名1 别名2 …）}。
     *
     * <p><b>原问句的每一个字符（含标点与空格）都不被改写、不被删除</b>，
     * 这样即使扩展串意外泄漏到日志或排查现场，人也能一眼读出原话。
     *
     * <p>去重口径（§7.4-2）：扩展词之间、扩展词与原串之间都按 {@code term_norm} 做
     * 大小写不敏感去重。
     *
     * @param original 原问句
     * @param dict     词典快照
     * @param budget   预算
     * @param picked   已按组数截断的命中列表（按位置升序）
     * @return 装配后的查询串与命中轨迹
     */
    private Assembled build(
            String original, SynonymDictionary dict, SynonymBudget budget, List<Match> picked) {

        // 已出现过的归一化词形：先放入所有命中面（原串里已有的词不必再加一遍）
        Set<String> usedNorms = new LinkedHashSet<>();
        for (Match m : picked) {
            usedNorms.add(m.normalizedTerm());
        }

        StringBuilder sb = new StringBuilder(original.length() + 64);
        List<SynonymHit> hits = new ArrayList<>(picked.size());
        int cursor = 0;
        for (Match m : picked) {
            sb.append(original, cursor, m.end());
            cursor = m.end();

            GroupEntry entry = dict.group(m.groupId());
            List<String> additions = pickAdditions(entry, budget, usedNorms, original);
            if (!additions.isEmpty()) {
                sb.append(OPEN);
                for (int k = 0; k < additions.size(); k++) {
                    if (k > 0) {
                        sb.append(SEP);
                    }
                    sb.append(additions.get(k));
                }
                sb.append(CLOSE);
            }
            hits.add(new SynonymHit(
                    m.groupId(),
                    m.matchedTerm(),
                    entry == null ? m.matchedTerm() : entry.canonicalTerm(),
                    additions.size()));
        }
        sb.append(original, cursor, original.length());
        return new Assembled(sb.toString(), hits);
    }

    /**
     * 选出一个组实际并入的扩展词。
     *
     * <p>取 {@code orderedTerms} 前 {@code maxTermsPerGroup + 1} 项（规范词恒在首位，
     * 不占别名额度），逐项去重后返回。
     *
     * @param entry     组条目；可为 {@code null}（词典与索引不一致的极端情况）
     * @param budget    预算
     * @param usedNorms 已使用的归一化词形（跨组累积，方法内会更新）
     * @param original  原问句，用于「扩展词与原串去重」
     * @return 实际并入的扩展词原文列表，可能为空
     */
    private List<String> pickAdditions(
            GroupEntry entry, SynonymBudget budget, Set<String> usedNorms, String original) {
        if (entry == null || entry.orderedTerms().isEmpty()) {
            return List.of();
        }
        int limit = Math.min(entry.orderedTerms().size(), budget.maxTermsPerGroup() + 1);
        List<String> additions = new ArrayList<>(limit);
        for (int k = 0; k < limit; k++) {
            String term = entry.orderedTerms().get(k);
            String norm = SynonymTermNormalizer.normalize(term);
            if (norm.isEmpty() || usedNorms.contains(norm)) {
                continue;
            }
            if (occursIn(original, norm)) {
                usedNorms.add(norm);
                continue;
            }
            usedNorms.add(norm);
            additions.add(term);
        }
        return additions;
    }

    /**
     * 判断某个归一化词形是否已以完整形态出现在原问句中。
     *
     * <p>ASCII 词要求词边界，避免「原串里有 WITH，就不再补 IT 的别名」这种误判。
     *
     * @param text 原问句
     * @param norm 归一化词形
     * @return 已出现返回 {@code true}
     */
    private boolean occursIn(String text, String norm) {
        int len = norm.length();
        if (len == 0 || len > text.length()) {
            return false;
        }
        boolean asciiWord = SynonymTermNormalizer.isAsciiWord(norm);
        for (int i = 0; i + len <= text.length(); i++) {
            String window = text.substring(i, i + len);
            if (!norm.equals(SynonymTermNormalizer.normalize(window))) {
                continue;
            }
            if (!asciiWord || SynonymTermNormalizer.boundaryOk(text, i, i + len)) {
                return true;
            }
        }
        return false;
    }

    /** 丢弃列表里展示的组名：优先规范词，词典缺失时回落命中面。 */
    private String groupLabel(SynonymDictionary dict, Match m) {
        GroupEntry entry = dict.group(m.groupId());
        return entry == null || entry.canonicalTerm() == null
                ? m.matchedTerm()
                : entry.canonicalTerm();
    }

    // ---------------------------------------------------------------- 内部类型

    /**
     * 一次命中的区间。
     *
     * @param start          起点（含），相对<b>原问句</b>
     * @param end            终点（不含）
     * @param groupId        命中的术语组
     * @param matchedTerm    原问句中的原文片段
     * @param normalizedTerm 该片段的归一化词形
     */
    private record Match(int start, int end, Long groupId, String matchedTerm, String normalizedTerm) {
    }

    /**
     * 扫描结果。
     *
     * @param matches           命中区间（位置升序、互不重叠、每组只留首次）
     * @param skippedShortTerms 因过短被跳过、但确实出现在问句中的词
     */
    private record ScanResult(List<Match> matches, List<String> skippedShortTerms) {
    }

    /**
     * 装配产物。
     *
     * @param query 装配后的查询串
     * @param hits  命中轨迹
     */
    private record Assembled(String query, List<SynonymHit> hits) {
    }
}
