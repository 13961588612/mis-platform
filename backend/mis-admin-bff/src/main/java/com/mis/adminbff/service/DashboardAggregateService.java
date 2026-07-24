package com.mis.adminbff.service;

import com.mis.adminbff.client.AuditWebClient;
import com.mis.adminbff.client.AuthWebClient;
import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.dto.DashboardStatsVO;
import com.mis.adminbff.support.RequestContext;
import org.springframework.stereotype.Service;

@Service
public class DashboardAggregateService {

    private final IamWebClient iamWebClient;
    private final OrgWebClient orgWebClient;
    private final AuditWebClient auditWebClient;
    private final AuthWebClient authWebClient;

    public DashboardAggregateService(
            IamWebClient iamWebClient,
            OrgWebClient orgWebClient,
            AuditWebClient auditWebClient,
            AuthWebClient authWebClient) {
        this.iamWebClient = iamWebClient;
        this.orgWebClient = orgWebClient;
        this.auditWebClient = auditWebClient;
        this.authWebClient = authWebClient;
    }

    public DashboardStatsVO stats() {
        Long tenantId = RequestContext.requireTenantId();
        Long appId = RequestContext.requireAppId();
        long userCount = iamWebClient.userCount(tenantId, appId);
        long orgCount = orgWebClient.orgCount(tenantId);
        long todayLoginCount = auditWebClient.todayLoginCount(tenantId, appId);
        long onlineUserCount = authWebClient.onlineUserCount(appId);
        return new DashboardStatsVO(userCount, orgCount, todayLoginCount, onlineUserCount);
    }
}
