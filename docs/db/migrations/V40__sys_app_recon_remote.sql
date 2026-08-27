-- recon 对账平台：以 micro-app 远程子应用（runtime='remote'）注册为平台子系统
-- 说明：
-- 1. entry 由子应用独立部署地址决定，部署时把 mfe_remote 替换为 recon-admin-web 的实际地址
--    （如 https://recon.example.com/）。前端未从后端拿到该字段前，走 VITE_RECON_ENTRY / 默认兜底。
-- 2. enterable 由 BFF 按 runtime 判断（remote 视为可进）。
-- 3. recon-service 自身认证（JWT）落地后，此子应用在壳内才受令牌保护。
INSERT INTO sys_app (id, tenant_id, code, name, icon, base_path, mfe_remote, sort, status,
                     kind, runtime, description, portal_group, created_at, updated_at)
VALUES (4, 1, 'recon', '对账平台', 'Scale', '/recon', 'http://localhost:5176/', 4, 1,
        'subsystem', 'remote', '数据对账与差异处理', 'operations', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
