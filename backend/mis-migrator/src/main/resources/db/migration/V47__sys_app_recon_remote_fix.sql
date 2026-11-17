-- recon 对账平台：修复 V40 应用标记 Success 但应用行未真正落库的问题
-- 背景：共享库 flyway 历史中 V40__sys_app_recon_remote 已标记 Success，但 sys_app
--       中不存在 recon 行（可能因当时 ON CONFLICT (id) DO NOTHING 静默跳过）。
--       已应用的迁移不会重跑，故以 V47 幂等 UPSERT 补齐。
-- 说明：
-- 1. 若 id=4 空闲 → 正常插入；若 id=4 已存在且 code='recon'（如 status=0 残留）→ 更新为启用；
-- 2. 若 id=4 被其它应用占用 → 不覆盖（WHERE code='recon' 守卫），需人工处理。
INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
VALUES (4, 1, 'recon', '对账平台', 'Scale', '/recon', 'http://localhost:5176/', 4, 1,
        'subsystem', 'remote', '数据对账与差异处理', 'operations', NOW(), NOW())
ON CONFLICT (id) DO UPDATE
   SET tenant_id   = EXCLUDED.tenant_id,
       code        = EXCLUDED.code,
       name        = EXCLUDED.name,
       icon        = EXCLUDED.icon,
       base_path   = EXCLUDED.base_path,
       mfe_remote  = EXCLUDED.mfe_remote,
       sort        = EXCLUDED.sort,
       status      = EXCLUDED.status,
       kind        = EXCLUDED.kind,
       runtime     = EXCLUDED.runtime,
       description = EXCLUDED.description,
       portal_group= EXCLUDED.portal_group,
       updated_at  = NOW()
WHERE sys_app.code = 'recon';
