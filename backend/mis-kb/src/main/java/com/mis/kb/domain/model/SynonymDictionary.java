package com.mis.kb.domain.model;

import java.util.Map;

/**
 * 同义词内存词典<b>不可变快照</b>（Wave D，D6 约束 1 的落点）。
 *
 * <p><b>为什么必须不可变：</b>读侧是问答检索热路径，QPS 最高的地方。
 * 若词典可变，读写就要加锁，锁又要放在每次 {@code expand()} 上 —— 这正是我们想省掉的开销。
 * 不可变快照 + {@code volatile} 引用替换，让读侧<b>零锁、零全表扫</b>，
 * 刷新只是把引用指向一个新实例（AC-06「热路径不出现逐次全表扫库」的结构性保证）。
 *
 * <p>构造后全部字段只读：两个 Map 在构造函数里用 {@code Map.copyOf} 冻结，
 * 外部即使持有原集合的引用也改不动快照内容。
 */
public final class SynonymDictionary {

    /** 空词典的版本号哨兵：比任何真实版本号都小，保证首次轮询必然触发加载。 */
    public static final long EMPTY_VERSION = -1L;

    private static final SynonymDictionary EMPTY =
            new SynonymDictionary(EMPTY_VERSION, Map.of(), Map.of());

    private final long version;

    /** {@code term_norm → groupId}，<b>仅含启用组</b>的词条。 */
    private final Map<String, Long> termIndex;

    /** {@code groupId → 组条目}。 */
    private final Map<Long, GroupEntry> groups;

    /** 最长匹配扫描的窗口上界（= termIndex 中最长键的长度）。 */
    private final int maxTermLength;

    /**
     * 构造快照。
     *
     * @param version   本快照对应的 {@code kb_synonym_config.dict_version}
     * @param termIndex {@code term_norm → groupId}；{@code null} 视为空
     * @param groups    {@code groupId → GroupEntry}；{@code null} 视为空
     */
    public SynonymDictionary(long version, Map<String, Long> termIndex, Map<Long, GroupEntry> groups) {
        this.version = version;
        this.termIndex = termIndex == null ? Map.of() : Map.copyOf(termIndex);
        this.groups = groups == null ? Map.of() : Map.copyOf(groups);
        int max = 0;
        for (String key : this.termIndex.keySet()) {
            if (key != null && key.length() > max) {
                max = key.length();
            }
        }
        this.maxTermLength = max;
    }

    /**
     * 空词典（启动期加载失败时的兜底，保证应用<b>不会因词表问题起不来</b>）。
     *
     * @return 共享的空快照实例
     */
    public static SynonymDictionary empty() {
        return EMPTY;
    }

    /**
     * 快照版本号。
     *
     * @return 版本号；空词典为 {@link #EMPTY_VERSION}
     */
    public long version() {
        return version;
    }

    /**
     * 启用组数量。
     *
     * @return 组数
     */
    public int groupCount() {
        return groups.size();
    }

    /**
     * 索引内词条数量。
     *
     * @return 词条数
     */
    public int termCount() {
        return termIndex.size();
    }

    /**
     * 按归一化词形查所属组。
     *
     * @param termNorm 归一化词形
     * @return 组 ID；未命中返回 {@code null}
     */
    public Long lookup(String termNorm) {
        if (termNorm == null || termNorm.isEmpty()) {
            return null;
        }
        return termIndex.get(termNorm);
    }

    /**
     * 取组条目。
     *
     * @param groupId 组 ID
     * @return 组条目；不存在返回 {@code null}
     */
    public GroupEntry group(Long groupId) {
        if (groupId == null) {
            return null;
        }
        return groups.get(groupId);
    }

    /**
     * 最长匹配扫描的窗口上界。
     *
     * @return 索引中最长词条的字符长度；空词典为 0
     */
    public int maxTermLength() {
        return maxTermLength;
    }

    /**
     * 是否为空词典（无任何可匹配词条）。
     *
     * @return 词条索引为空返回 {@code true}
     */
    public boolean isEmpty() {
        return termIndex.isEmpty();
    }
}
