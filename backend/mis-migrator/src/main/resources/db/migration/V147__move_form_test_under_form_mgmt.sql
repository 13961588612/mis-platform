-- V147__move_form_test_under_form_mgmt.sql
-- 将「测试表单」菜单从工作台挪到「表单管理」目录下（表单注册同级）| PostgreSQL 16 | 幂等
--
-- ## 背景
--   V146 挂在工作台 95001；产品要求侧栏落在系统管理 → 表单管理 → 表单注册下方。
--   父菜单改 95010（表单管理），路径改 /system/form-test，sort=2（表单注册 sort=1 之后）。
--
-- ⚠️ 只追加；绝不修改 V1~V146。

UPDATE sys_menu
   SET parent_id = 95010,
       path = '/system/form-test',
       icon = 'ClipboardList',
       sort = 2,
       updated_at = NOW()
 WHERE id = 95110
   AND code = 'taskflow-form-test'
   AND (
     parent_id IS DISTINCT FROM 95010
     OR path IS DISTINCT FROM '/system/form-test'
     OR icon IS DISTINCT FROM 'ClipboardList'
     OR sort IS DISTINCT FROM 2
   );
