package com.mis.system.service;

import com.mis.common.core.exception.BusinessException;
import com.mis.common.core.exception.ResultCode;
import com.mis.system.domain.entity.SysMenu;
import com.mis.system.domain.repository.SysMenuRepository;
import com.mis.system.dto.MenuCreateRequest;
import com.mis.system.dto.MenuUpdateRequest;
import com.mis.system.dto.MenuVO;
import com.mis.system.support.IdGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
public class MenuService {

    private final SysMenuRepository menuRepository;

    public MenuService(SysMenuRepository menuRepository) {
        this.menuRepository = menuRepository;
    }

    @Transactional(readOnly = true)
    public List<MenuVO> tree(Long appId) {
        List<SysMenu> menus = menuRepository.findByAppIdOrderBySortAscCodeAsc(appId);
        return buildTree(menus);
    }

    /**
     * 动态路由：仅返回授权菜单及其祖先目录（visible=1, status=1, type=1|2）。
     */
    @Transactional(readOnly = true)
    public List<MenuVO> router(Long appId, List<Long> allowedMenuIds) {
        if (allowedMenuIds == null || allowedMenuIds.isEmpty()) {
            return List.of();
        }
        Map<Long, SysMenu> allById = menuRepository.findByAppIdAndStatusOrderBySortAscCodeAsc(appId, 1).stream()
                .collect(Collectors.toMap(SysMenu::getId, m -> m, (a, b) -> a));
        Set<Long> include = new HashSet<>();
        for (Long id : allowedMenuIds) {
            SysMenu current = allById.get(id);
            while (current != null) {
                include.add(current.getId());
                if (current.getParentId() == null || current.getParentId() == 0L) {
                    break;
                }
                current = allById.get(current.getParentId());
            }
        }
        List<SysMenu> filtered = allById.values().stream()
                .filter(m -> include.contains(m.getId()))
                .filter(m -> m.getType() != null && m.getType() != 3)
                .filter(m -> m.getVisible() == null || m.getVisible() == 1)
                .sorted(Comparator.comparing(SysMenu::getSort).thenComparing(SysMenu::getCode))
                .toList();
        return buildTree(filtered);
    }

    @Transactional(readOnly = true)
    public List<String> permissionCodes(List<Long> menuIds) {
        if (menuIds == null || menuIds.isEmpty()) {
            return List.of();
        }
        return menuRepository.findByIdInAndStatus(menuIds, 1).stream()
                .map(SysMenu::getPermission)
                .filter(StringUtils::hasText)
                .distinct()
                .toList();
    }

    @Transactional(readOnly = true)
    public MenuVO getById(Long id) {
        return toVo(require(id), List.of());
    }

    @Transactional
    public MenuVO create(MenuCreateRequest request) {
        String code = nextChildCode(request.appId(), request.parentId());
        if (StringUtils.hasText(request.permission())
                && menuRepository.existsByAppIdAndPermissionAndStatus(request.appId(), request.permission(), 1)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, "permission 已存在");
        }
        Instant now = Instant.now();
        SysMenu menu = new SysMenu();
        menu.setId(IdGenerator.nextId());
        menu.setTenantId(request.tenantId());
        menu.setAppId(request.appId());
        menu.setParentId(request.parentId());
        menu.setCode(code);
        menu.setName(request.name());
        menu.setType(request.type());
        menu.setPath(request.path());
        menu.setComponent(request.component());
        menu.setPermission(request.permission());
        menu.setIcon(request.icon());
        menu.setSort(request.sort() != null ? request.sort() : 0);
        menu.setVisible(request.visible() != null ? request.visible() : 1);
        menu.setStatus(1);
        menu.setCreatedAt(now);
        menu.setUpdatedAt(now);
        menuRepository.save(menu);
        return toVo(menu, List.of());
    }

    @Transactional
    public MenuVO update(Long id, MenuUpdateRequest request) {
        SysMenu menu = require(id);
        menu.setName(request.name());
        if (request.path() != null) {
            menu.setPath(request.path());
        }
        if (request.component() != null) {
            menu.setComponent(request.component());
        }
        if (request.permission() != null) {
            menu.setPermission(request.permission());
        }
        if (request.icon() != null) {
            menu.setIcon(request.icon());
        }
        if (request.sort() != null) {
            menu.setSort(request.sort());
        }
        if (request.visible() != null) {
            menu.setVisible(request.visible());
        }
        if (request.status() != null) {
            menu.setStatus(request.status());
        }
        menu.setUpdatedAt(Instant.now());
        menuRepository.save(menu);
        return toVo(menu, List.of());
    }

    @Transactional
    public void delete(Long id) {
        SysMenu menu = require(id);
        if (menuRepository.existsByParentIdAndStatus(id, 1)) {
            throw new BusinessException(ResultCode.FORBIDDEN, "存在子菜单，无法删除");
        }
        menu.setStatus(0);
        menu.setUpdatedAt(Instant.now());
        menuRepository.save(menu);
    }

    private String nextChildCode(Long appId, Long parentId) {
        if (parentId == null || parentId == 0L) {
            List<SysMenu> roots = menuRepository.findByAppIdOrderBySortAscCodeAsc(appId).stream()
                    .filter(m -> m.getParentId() == null || m.getParentId() == 0L)
                    .toList();
            int next = roots.size() + 1;
            return String.format("%04d", next);
        }
        SysMenu parent = require(parentId);
        List<SysMenu> siblings = menuRepository.findByAppIdOrderBySortAscCodeAsc(appId).stream()
                .filter(m -> parentId.equals(m.getParentId()))
                .toList();
        int next = siblings.size() + 1;
        return parent.getCode() + String.format("%04d", next);
    }

    private SysMenu require(Long id) {
        return menuRepository.findById(id)
                .orElseThrow(() -> new BusinessException(ResultCode.NOT_FOUND, "菜单不存在"));
    }

    private List<MenuVO> buildTree(List<SysMenu> menus) {
        Map<Long, List<SysMenu>> byParent = new HashMap<>();
        for (SysMenu menu : menus) {
            Long pid = menu.getParentId() == null ? 0L : menu.getParentId();
            byParent.computeIfAbsent(pid, k -> new ArrayList<>()).add(menu);
        }
        return buildChildren(0L, byParent);
    }

    private List<MenuVO> buildChildren(Long parentId, Map<Long, List<SysMenu>> byParent) {
        List<SysMenu> children = byParent.getOrDefault(parentId, List.of());
        List<MenuVO> result = new ArrayList<>(children.size());
        for (SysMenu menu : children) {
            result.add(toVo(menu, buildChildren(menu.getId(), byParent)));
        }
        return result;
    }

    private MenuVO toVo(SysMenu menu, List<MenuVO> children) {
        return new MenuVO(
                String.valueOf(menu.getId()),
                String.valueOf(menu.getTenantId()),
                String.valueOf(menu.getAppId()),
                String.valueOf(menu.getParentId()),
                menu.getCode(),
                menu.getName(),
                menu.getType(),
                menu.getPath(),
                menu.getComponent(),
                menu.getPermission(),
                menu.getIcon(),
                menu.getSort(),
                menu.getVisible(),
                menu.getStatus(),
                children);
    }

    public static List<Long> parseIds(String ids) {
        if (!StringUtils.hasText(ids)) {
            return List.of();
        }
        return Arrays.stream(ids.split(","))
                .map(String::trim)
                .filter(s -> !s.isEmpty())
                .map(Long::valueOf)
                .toList();
    }
}
