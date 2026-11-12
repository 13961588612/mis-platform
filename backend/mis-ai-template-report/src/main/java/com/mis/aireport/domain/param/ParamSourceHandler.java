package com.mis.aireport.domain.param;

import com.mis.aireport.domain.entity.AiParamSource;

/** 按当前用户身份解析参数来源选项。 */
public interface ParamSourceHandler {

    /** 与 {@code ai_param_source.handler_bean} 对齐。 */
    String beanName();

    ParamResolveResult resolve(Long userId, AiParamSource source);

    /** execute 二次校验：value 是否仍属该用户可选。 */
    boolean accepts(Long userId, AiParamSource source, String value);
}
