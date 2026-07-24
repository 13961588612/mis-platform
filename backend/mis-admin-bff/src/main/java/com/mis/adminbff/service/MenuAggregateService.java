package com.mis.adminbff.service;

import com.mis.adminbff.client.IamWebClient;
import com.mis.adminbff.client.SystemWebClient;
import com.mis.adminbff.client.model.MenuVO;
import com.mis.adminbff.dto.MenuCreateRequest;
import com.mis.adminbff.dto.MenuUpdateRequest;
import com.mis.adminbff.dto.RouterNode;
import com.mis.adminbff.support.RequestContext;
import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class MenuAggregateService {

    private final IamWebClient iamWebClient;
    private final SystemWebClient systemWebClient;

    public MenuAggregateService(IamWebClient iamWebClient, SystemWebClient systemWebClient) {
        this.iamWebClient = iamWebClient;
        this.systemWebClient = systemWebClient;
    }

    /** 当前用户动态路由：IAM menuIds + system router 组装。 */
    public List<RouterNode> router() {
        Long userId = RequestContext.requireLoginUser().getUserId();
        if (userId == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        Long appId = RequestContext.requireAppId();
        List<Long> menuIds = iamWebClient.listUserMenuIds(userId);
        List<MenuVO> menus = systemWebClient.router(appId, menuIds);
        return menus.stream().map(this::toRouterNode).toList();
    }

    /** 当前用户 permission 码（供前端按钮鉴权）。 */
    public List<String> currentPermissions() {
        Long userId = RequestContext.requireLoginUser().getUserId();
        if (userId == null) {
            throw new BusinessException(ResultCode.UNAUTHORIZED);
        }
        List<Long> menuIds = iamWebClient.listUserMenuIds(userId);
        return systemWebClient.permissions(menuIds);
    }

    public List<MenuVO> tree() {
        return systemWebClient.tree(RequestContext.requireAppId());
    }

    public MenuVO get(Long id) {
        return systemWebClient.getMenu(id);
    }

    public MenuVO create(MenuCreateRequest request) {
        return systemWebClient.createMenu(SystemWebClient.menuCreateBody(
                RequestContext.requireTenantId(),
                RequestContext.requireAppId(),
                request.parentId(),
                request.name(),
                request.type(),
                request.path(),
                request.component(),
                request.permission(),
                request.icon(),
                request.sort(),
                request.visible()));
    }

    public MenuVO update(Long id, MenuUpdateRequest request) {
        Map<String, Object> body = new HashMap<>();
        body.put("name", request.name());
        body.put("path", request.path());
        body.put("component", request.component());
        body.put("permission", request.permission());
        body.put("icon", request.icon());
        body.put("sort", request.sort());
        body.put("visible", request.visible());
        body.put("status", request.status());
        return systemWebClient.updateMenu(id, body);
    }

    public void delete(Long id) {
        systemWebClient.deleteMenu(id);
    }

    private RouterNode toRouterNode(MenuVO menu) {
        String routeName = StringUtils.hasText(menu.code()) ? menu.code() : menu.name();
        List<RouterNode> children = menu.children() == null
                ? List.of()
                : menu.children().stream().map(this::toRouterNode).toList();
        return new RouterNode(
                menu.id(),
                routeName,
                menu.path(),
                menu.component(),
                new RouterNode.RouterMeta(menu.name(), menu.icon(), menu.permission()),
                children.isEmpty() ? null : children);
    }
}
