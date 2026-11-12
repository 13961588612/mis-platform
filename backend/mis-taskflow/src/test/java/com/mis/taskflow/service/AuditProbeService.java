package com.mis.taskflow.service;

import com.mis.taskflow.support.AuditContext;
import com.mis.taskflow.support.BusinessOperation;
import org.springframework.stereotype.Service;

/**
 * 测试专用：{@code @BusinessOperation} 切面探针。
 */
@Service
public class AuditProbeService {

    @BusinessOperation(module = "测试模块", type = "UPDATE",
            businessType = "PROBE", description = "探针更新")
    public void update(String businessId, String before, String after) {
        AuditContext.businessId(businessId);
        AuditContext.before(before);
        AuditContext.after(after);
    }

    @BusinessOperation(module = "测试模块", type = "CREATE", businessType = "PROBE")
    public void failing(String businessId) {
        AuditContext.businessId(businessId);
        throw new IllegalStateException("模拟业务异常");
    }
}