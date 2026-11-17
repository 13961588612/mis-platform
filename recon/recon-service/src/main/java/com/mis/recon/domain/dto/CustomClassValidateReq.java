package com.mis.recon.domain.dto;

import lombok.Data;

/**
 * 自定义类名实时校验请求（第三批 C6，需求 §3.4.1）。
 * <p>管理端类名输入失焦时调用，校验类可加载 + 实现对应接口（复用 CustomLoader.validate）。</p>
 */
@Data
public class CustomClassValidateReq {

    /** 配置的全限定类名（可简名，自动补 com.mis.recon.custom. 前缀） */
    private String className;

    /**
     * 校验目标：
     * <ul>
     *   <li>custom → CustomMatcher</li>
     *   <li>custom_check → CustomCheckExecutor</li>
     *   <li>custom_compare → CustomComparator（Tab C 规则行）</li>
     * </ul>
     */
    private String checkType;
}
