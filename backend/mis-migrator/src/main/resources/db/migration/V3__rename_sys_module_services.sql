-- Sprint 2 服务边界：sys_module 对齐 mis-iam / mis-org（ADR-016）
-- 不修改已发布的 V1/V2；将原 mis-user + mis-rbac 收敛为 mis-iam。

-- 1) 原「用户」模块 → mis-iam
UPDATE sys_module
SET code         = 'iam',
    name         = '身份权限模块',
    service_name = 'mis-iam',
    updated_at   = NOW()
WHERE id = 1
  AND service_name = 'mis-user';

-- 2) 组织模块：服务名已是 mis-org，仅同步展示名
UPDATE sys_module
SET name       = '组织人事模块',
    updated_at = NOW()
WHERE id = 2
  AND code = 'org';

-- 3) 原 rbac 下 API 元数据改挂到 iam（module_id=1）
UPDATE sys_api
SET module_id  = 1,
    updated_at = NOW()
WHERE module_id = 3;

-- 4) 用户 API 树根 catalog 名称与模块一致
UPDATE sys_api
SET name       = '身份权限模块',
    updated_at = NOW()
WHERE id = 1000
  AND code = '0001';

-- 5) 删除已合并的 rbac 模块行（sys_api 无 FK；uk_module_* 释放）
DELETE FROM sys_module
WHERE id = 3
  AND code = 'rbac'
  AND service_name = 'mis-rbac';
