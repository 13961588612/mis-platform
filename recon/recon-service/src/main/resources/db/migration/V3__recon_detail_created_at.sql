-- recon-service Flyway V3：recon_detail 补 created_at 列。
-- DetailDao.upsertDetail 依赖 created_at（插入时 now()），V1 建表遗漏；与其他配置表保持一致。
ALTER TABLE recon_detail ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now() NOT NULL;
