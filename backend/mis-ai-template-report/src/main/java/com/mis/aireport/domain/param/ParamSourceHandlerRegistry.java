package com.mis.aireport.domain.param;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

@Component
public class ParamSourceHandlerRegistry {

    private final Map<String, ParamSourceHandler> byBean;

    public ParamSourceHandlerRegistry(List<ParamSourceHandler> handlers) {
        this.byBean = handlers.stream()
                .collect(Collectors.toMap(ParamSourceHandler::beanName, Function.identity(), (a, b) -> a));
    }

    public ParamSourceHandler require(String handlerBean) {
        ParamSourceHandler h = byBean.get(handlerBean);
        if (h == null) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "未注册参数来源 Handler: " + handlerBean);
        }
        return h;
    }
}
