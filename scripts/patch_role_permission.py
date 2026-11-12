import re

# ========== Step 1: RolePermissionService.java ==========
path = r'D:\code\mis-platform\backend\mis-iam\src\main\java\com\mis\iam\service\RolePermissionService.java'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1) getDataScope - include store
old_get = """        List<Long> deptIds = rolePermissionRepository.findByRoleIdAndPermType(roleId, PermType.dept).stream()
                .map(SysRolePermission::getTargetId)
                .toList();
        return new RoleDataScopeVO(role.getDataScope(), orgIds, deptIds);"""

new_get = """        List<Long> deptIds = rolePermissionRepository.findByRoleIdAndPermType(roleId, PermType.dept).stream()
                .map(SysRolePermission::getTargetId)
                .toList();
        List<Long> storeIds = rolePermissionRepository.findByRoleIdAndPermType(roleId, PermType.store).stream()
                .map(SysRolePermission::getTargetId)
                .toList();
        return new RoleDataScopeVO(role.getDataScope(), orgIds, deptIds, storeIds);"""

content = content.replace(old_get, new_get)
print("RolePermissionService: getDataScope patched" if old_get not in content else "WARNING: getDataScope not found")

# 2) assignDataScope validation - add store check
old_validate = """        if (scope == 5 && CollectionUtils.isEmpty(orgIds) && CollectionUtils.isEmpty(deptIds)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, \\"自定义数据范围需至少指定组织或部门\\");
        }"""

new_validate = """        List<Long> storeIds = request.storeIds() != null ? request.storeIds() : List.of();
        if (scope == 5 && CollectionUtils.isEmpty(orgIds) && CollectionUtils.isEmpty(deptIds) && CollectionUtils.isEmpty(storeIds)) {
            throw new BusinessException(ResultCode.VALIDATION_ERROR, \\"自定义数据范围需至少指定组织、部门或门店\\");
        }"""

content = content.replace(old_validate, new_validate)
print("RolePermissionService: assignDataScope validation patched" if old_validate not in content else "WARNING: validation not found")

# 3) assignDataScope persist - delete + insert for store
old_persist = """        rolePermissionRepository.deleteByRoleIdAndPermType(roleId, PermType.org);
        rolePermissionRepository.deleteByRoleIdAndPermType(roleId, PermType.dept);
        Instant now = Instant.now();
        if (scope == 5) {
            for (Long orgId : orgIds) {
                SysRolePermission rp = new SysRolePermission();
                rp.setId(IdGenerator.nextId());
                rp.setRoleId(roleId);
                rp.setPermType(PermType.org);
                rp.setTargetId(orgId);
                rp.setCreatedAt(now);
                rolePermissionRepository.save(rp);
            }
            for (Long deptId : deptIds) {
                SysRolePermission rp = new SysRolePermission();
                rp.setId(IdGenerator.nextId());
                rp.setRoleId(roleId);
                rp.setPermType(PermType.dept);
                rp.setTargetId(deptId);
                rp.setCreatedAt(now);
                rolePermissionRepository.save(rp);
            }
        }"""

new_persist = """        rolePermissionRepository.deleteByRoleIdAndPermType(roleId, PermType.org);
        rolePermissionRepository.deleteByRoleIdAndPermType(roleId, PermType.dept);
        rolePermissionRepository.deleteByRoleIdAndPermType(roleId, PermType.store);
        Instant now = Instant.now();
        if (scope == 5) {
            for (Long orgId : orgIds) {
                SysRolePermission rp = new SysRolePermission();
                rp.setId(IdGenerator.nextId());
                rp.setRoleId(roleId);
                rp.setPermType(PermType.org);
                rp.setTargetId(orgId);
                rp.setCreatedAt(now);
                rolePermissionRepository.save(rp);
            }
            for (Long deptId : deptIds) {
                SysRolePermission rp = new SysRolePermission();
                rp.setId(IdGenerator.nextId());
                rp.setRoleId(roleId);
                rp.setPermType(PermType.dept);
                rp.setTargetId(deptId);
                rp.setCreatedAt(now);
                rolePermissionRepository.save(rp);
            }
            for (Long storeId : storeIds) {
                SysRolePermission rp = new SysRolePermission();
                rp.setId(IdGenerator.nextId());
                rp.setRoleId(roleId);
                rp.setPermType(PermType.store);
                rp.setTargetId(storeId);
                rp.setCreatedAt(now);
                rolePermissionRepository.save(rp);
            }
        }"""

content = content.replace(old_persist, new_persist)
print("RolePermissionService: assignDataScope persist patched" if old_persist not in content else "WARNING: persist not found")

# 4) Add listCustomStoreIdsByUser after listCustomDeptIdsByUser
old_method_end = """    @Transactional(readOnly = true)
    public List<Long> listCustomDeptIdsByUser(Long userId) {
        return rolePermissionRepository.findTargetIdsByUserIdAndPermType(userId, PermType.dept);
    }

    private void bumpUsersOfRole"""

new_method_end = """    @Transactional(readOnly = true)
    public List<Long> listCustomDeptIdsByUser(Long userId) {
        return rolePermissionRepository.findTargetIdsByUserIdAndPermType(userId, PermType.dept);
    }

    /** CUSTOM 数据范围内：查询用户角色下的门店权限 target_id 并集。 */
    @Transactional(readOnly = true)
    public List<Long> listCustomStoreIdsByUser(Long userId) {
        return rolePermissionRepository.findTargetIdsByUserIdAndPermType(userId, PermType.store);
    }

    private void bumpUsersOfRole"""

content = content.replace(old_method_end, new_method_end)
print("RolePermissionService: listCustomStoreIdsByUser added" if old_method_end not in content else "WARNING: method end not found")

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print("=" * 60)
print("Step 1 DONE - mis-iam changes complete")
