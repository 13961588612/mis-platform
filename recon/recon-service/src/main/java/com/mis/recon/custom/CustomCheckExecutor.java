package com.mis.recon.custom;

import java.util.List;

/**
 * 整检查自定义执行器（strategy=custom_check，方案设计 §13 / custom-需求规格 §3.3）。
 * <p>匹配+比较整体交给自定义类：入参整检查上下文（多数据集行集 + 参数），产出差异列表
 * 直接 confirmed（同 sum_check 单源自证思路），差异身份（matchKeyHash）由实现类决定。</p>
 */
public interface CustomCheckExecutor {

    /**
     * 执行整检查。
     *
     * @param ctx 整检查上下文（scenarioCode/checkName/多数据集/参数）
     * @return 差异列表（直接 confirmed；可为空/null 视为无差异）
     */
    List<CustomDiff> execute(CustomCheckContext ctx);
}
