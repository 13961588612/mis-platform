package com.mis.adminbff.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.OrgWebClient;
import com.mis.adminbff.client.TaskflowWebClient;
import com.mis.adminbff.client.model.SentMessageDetailVO;
import com.mis.adminbff.client.model.SentMessageVO;
import com.mis.adminbff.client.model.UserBrief;
import com.mis.adminbff.client.model.PhoneUser;
import com.mis.adminbff.dto.MessageSendRequest;
import com.mis.adminbff.dto.PhoneResolveResult;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.common.core.result.PageResult;
import com.mis.common.security.context.LoginUser;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 后台发消息：在 BFF 把全员、部门、岗位类型、指定人解析成并集，再交给 taskflow 落库。
 */
@Service
public class MessageManageService {

    private static final int CHUNK = 500;

    private final IamWebClient iamWebClient;
    private final OrgWebClient orgWebClient;
    private final TaskflowWebClient taskflowWebClient;
    private final ObjectMapper objectMapper;

    public MessageManageService(IamWebClient iamWebClient,
                                OrgWebClient orgWebClient,
                                TaskflowWebClient taskflowWebClient,
                                ObjectMapper objectMapper) {
        this.iamWebClient = iamWebClient;
        this.orgWebClient = orgWebClient;
        this.taskflowWebClient = taskflowWebClient;
        this.objectMapper = objectMapper;
    }

    public int preview(LoginUser user, MessageSendRequest request) {
        return resolve(user, request).userIds().size();
    }

    public Long send(LoginUser user, MessageSendRequest request) {
        if (request.title() == null || request.title().isBlank()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "标题不能为空");
        }
        Resolved resolved = resolve(user, request);
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("title", request.title().trim());
        body.put("summary", request.summary());
        body.put("contentHtml", request.contentHtml());
        body.put("attachmentFileIds", request.attachmentFileIds() == null ? List.of() : request.attachmentFileIds());
        body.put("receiverIds", resolved.userIds());
        body.put("audience", resolved.audienceJson());
        body.put("senderId", user.getUserId());
        body.put("senderName", user.getUsername());
        return taskflowWebClient.sendManagedMessage(user.getTenantId(), body);
    }

    public PhoneResolveResult resolvePhones(LoginUser user, List<String> phones) {
        if (user.getTenantId() == null || user.getAppId() == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少租户或应用");
        }
        List<String> normalized = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        if (phones != null) {
            for (String raw : phones) {
                if (raw == null) {
                    continue;
                }
                String phone = raw.trim().replaceAll("\\s+", "");
                if (phone.isEmpty() || !seen.add(phone)) {
                    continue;
                }
                normalized.add(phone);
            }
        }
        if (normalized.isEmpty()) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "请填写手机号");
        }
        if (normalized.size() > 200) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "一次最多导入 200 个手机号");
        }
        Map<String, PhoneUser> byPhone = new LinkedHashMap<>();
        for (List<String> chunk : chunksOf(normalized)) {
            for (PhoneUser row : iamWebClient.enabledUsersByPhones(user.getTenantId(), user.getAppId(), chunk)) {
                if (row.phone() != null) {
                    byPhone.putIfAbsent(row.phone(), row);
                }
            }
        }
        List<PhoneResolveResult.MatchedUser> matched = new ArrayList<>();
        List<String> missing = new ArrayList<>();
        for (String phone : normalized) {
            PhoneUser row = byPhone.get(phone);
            if (row == null || row.id() == null) {
                missing.add(phone);
                continue;
            }
            String name = row.realName() != null && !row.realName().isBlank() ? row.realName() : row.username();
            matched.add(new PhoneResolveResult.MatchedUser(String.valueOf(row.id()), name, phone));
        }
        return new PhoneResolveResult(matched, missing);
    }

    public PageResult<SentMessageVO> sent(LoginUser user, String keyword, int page, int size) {
        return taskflowWebClient.sentMessages(user.getTenantId(), keyword, page, size);
    }

    public SentMessageDetailVO sentDetail(LoginUser user, Long id) {
        SentMessageDetailVO detail = taskflowWebClient.sentMessageDetail(user.getTenantId(), id);
        List<Long> ids = detail.receivers() == null ? List.of() : detail.receivers().stream()
                .map(r -> Long.valueOf(r.userId()))
                .toList();
        Map<Long, UserBrief> briefs = new LinkedHashMap<>();
        for (List<Long> chunk : chunks(ids)) {
            for (UserBrief brief : iamWebClient.userBriefs(user.getTenantId(), chunk)) {
                briefs.put(brief.id(), brief);
            }
        }
        List<SentMessageDetailVO.ReceiverReadVO> named = new ArrayList<>();
        if (detail.receivers() != null) {
            for (SentMessageDetailVO.ReceiverReadVO row : detail.receivers()) {
                UserBrief brief = briefs.get(Long.valueOf(row.userId()));
                String name = brief == null ? null : (brief.realName() != null && !brief.realName().isBlank()
                        ? brief.realName() : brief.username());
                named.add(new SentMessageDetailVO.ReceiverReadVO(row.userId(), name, row.read()));
            }
        }
        return new SentMessageDetailVO(detail.id(), detail.title(), detail.summary(), detail.content(),
                detail.attachments(), detail.audience(), detail.senderName(), detail.readCount(),
                detail.totalCount(), detail.receiversTruncated(), named, detail.createdAt());
    }

    private Resolved resolve(LoginUser user, MessageSendRequest request) {
        Long tenantId = user.getTenantId();
        Long appId = user.getAppId();
        if (tenantId == null || appId == null) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "缺少租户或应用");
        }
        List<MessageSendRequest.ScopeCondition> scopes = validScopes(request.scopes());
        boolean any = request.all()
                || notEmpty(request.userIds())
                || notEmpty(request.deptIds())
                || notEmpty(request.postTypeIds())
                || !scopes.isEmpty();
        if (!any) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "请选择接收范围");
        }
        List<Long> allUsers = request.all() ? iamWebClient.enabledUserIds(tenantId, appId) : List.of();
        List<Long> explicit = List.of();
        if (notEmpty(request.userIds())) {
            explicit = new ArrayList<>();
            for (List<Long> chunk : chunks(request.userIds())) {
                explicit.addAll(iamWebClient.enabledUserIdsAmong(tenantId, appId, chunk));
            }
        }
        List<Long> fromEmployees = List.of();
        if (!scopes.isEmpty()) {
            List<Map<String, Long>> body = scopes.stream().map(scope -> {
                Map<String, Long> item = new LinkedHashMap<>();
                item.put("deptId", scope.deptId());
                item.put("postTypeId", scope.postTypeId());
                return item;
            }).toList();
            List<Long> employees = orgWebClient.audienceEmployeeIds(tenantId, body);
            fromEmployees = usersOfEmployees(tenantId, appId, employees);
        } else if (notEmpty(request.deptIds()) || notEmpty(request.postTypeIds())) {
            List<Long> employees = orgWebClient.audienceEmployeeIdsLegacy(tenantId, request.deptIds(), request.postTypeIds());
            fromEmployees = usersOfEmployees(tenantId, appId, employees);
        }
        List<Long> userIds = MessageAudienceMerger.merge(request.all(), allUsers, explicit, fromEmployees);
        return new Resolved(userIds, audienceJson(request));
    }

    private String audienceJson(MessageSendRequest request) {
        try {
            ObjectNode node = objectMapper.createObjectNode();
            node.put("all", request.all());
            node.set("userIds", objectMapper.valueToTree(ids(request.userIds())));
            node.set("deptIds", objectMapper.valueToTree(ids(request.deptIds())));
            node.set("postTypeIds", objectMapper.valueToTree(ids(request.postTypeIds())));
            node.set("scopes", objectMapper.valueToTree(validScopes(request.scopes()).stream().map(scope -> {
                Map<String, String> item = new LinkedHashMap<>();
                item.put("deptId", String.valueOf(scope.deptId()));
                item.put("postTypeId", String.valueOf(scope.postTypeId()));
                item.put("deptName", scope.deptName() == null ? "" : scope.deptName());
                item.put("postTypeName", scope.postTypeName() == null ? "" : scope.postTypeName());
                return item;
            }).toList()));
            return objectMapper.writeValueAsString(node);
        } catch (Exception ex) {
            throw new BusinessException(ResultCode.INTERNAL_ERROR, "圈人快照写入失败");
        }
    }

    private static List<String> ids(List<Long> values) {
        if (values == null) {
            return List.of();
        }
        return values.stream().map(String::valueOf).toList();
    }

    private List<Long> usersOfEmployees(Long tenantId, Long appId, List<Long> employees) {
        List<Long> users = new ArrayList<>();
        for (List<Long> chunk : chunks(employees)) {
            users.addAll(iamWebClient.enabledUserIdsByEmployees(tenantId, appId, chunk));
        }
        return users;
    }

    private static List<MessageSendRequest.ScopeCondition> validScopes(List<MessageSendRequest.ScopeCondition> scopes) {
        if (scopes == null || scopes.isEmpty()) {
            return List.of();
        }
        List<MessageSendRequest.ScopeCondition> valid = new ArrayList<>();
        for (MessageSendRequest.ScopeCondition scope : scopes) {
            if (scope == null || scope.deptId() == null || scope.postTypeId() == null) {
                continue;
            }
            valid.add(scope);
        }
        if (valid.size() > 50) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "部门岗位条件最多 50 条");
        }
        return valid;
    }

    private static boolean notEmpty(List<?> list) {
        return list != null && !list.isEmpty();
    }

    private static List<List<Long>> chunks(List<Long> ids) {
        List<List<Long>> parts = new ArrayList<>();
        if (ids == null || ids.isEmpty()) {
            return parts;
        }
        for (int i = 0; i < ids.size(); i += CHUNK) {
            parts.add(ids.subList(i, Math.min(i + CHUNK, ids.size())));
        }
        return parts;
    }

    private static List<List<String>> chunksOf(List<String> values) {
        List<List<String>> parts = new ArrayList<>();
        for (int i = 0; i < values.size(); i += CHUNK) {
            parts.add(values.subList(i, Math.min(i + CHUNK, values.size())));
        }
        return parts;
    }

    private record Resolved(List<Long> userIds, String audienceJson) {
    }
}
