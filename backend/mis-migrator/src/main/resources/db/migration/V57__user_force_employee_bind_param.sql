-- 系统参数：用户是否强制绑定员工（默认关闭）。
-- 开启后：创建用户必须绑定员工；编辑时禁止解绑员工。
-- idempotent：仅当该 key 不存在时插入。
INSERT INTO sys_config (id, config_key, config_value, remark, created_at, updated_at)
SELECT 1001, 'user.force.employee.bind', 'false',
       '用户是否强制绑定员工：true=创建/编辑用户必须绑定员工且禁止解绑；false=允许非员工用户', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM sys_config WHERE config_key = 'user.force.employee.bind');
