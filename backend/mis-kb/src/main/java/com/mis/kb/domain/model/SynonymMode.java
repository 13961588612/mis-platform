package com.mis.kb.domain.model;

/**
 * 同义词扩展的<b>请求模式</b>（Wave D，输入侧）。
 *
 * <p><b>⚠ 不要与 {@link SynonymExpansion#status()} 混用。</b>本枚举描述的是「谁在调用扩展、
 * 要不要做版本校验」；{@code SynonymExpansion.status} 描述的是「这次扩展的结果长什么样」。
 * 两者<b>不是一一对应</b>——例如 {@code AUTO} 可能产出 {@code EXPANDED} / {@code NO_MATCH} /
 * {@code DISABLED_GLOBAL} 三种结果中的任意一种。设计文档 §7.3 明列此项为「本波次最容易写串的地方」。
 *
 * <table border="1">
 *   <caption>三种模式的行为</caption>
 *   <tr><th>值</th><th>谁传</th><th>行为</th></tr>
 *   <tr><td>{@link #AUTO}</td><td>问答检索热路径（{@code KbRetrieveService}）</td>
 *       <td>用 {@code dictLoader.current()}，<b>不做版本检查</b>（零额外查询，AC-06 的前提）</td></tr>
 *   <tr><td>{@link #FRESH}</td><td>命中测试（未勾选「本次不使用」）</td>
 *       <td>先 {@code ensureFresh()} 同步校验版本再扩展 —— Q7「即时生效」的兑现点</td></tr>
 *   <tr><td>{@link #OFF_THIS_RUN}</td><td>命中测试（勾选「本次不使用」）</td>
 *       <td>直接短路返回 {@code DISABLED_REQUEST}，<b>不查词典、不改库内开关</b></td></tr>
 * </table>
 */
public enum SynonymMode {

    /** 问答热路径：用当前内存快照，不做版本校验。 */
    AUTO,

    /** 命中测试：先同步校验词表版本再扩展，保证管理员刚保存的词立刻可验证。 */
    FRESH,

    /** 命中测试勾选「本次不使用同义词扩展」：本次请求短路，不影响全局开关。 */
    OFF_THIS_RUN
}
