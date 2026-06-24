\connect nacos

/*
 * Nacos 2.3.x 配置表（由官�?mysql-schema.sql 适配 PostgreSQL�?
 * 来源：https://github.com/alibaba/nacos/blob/2.3.2/distribution/conf/mysql-schema.sql
 */

CREATE TABLE config_info (
  id BIGSERIAL PRIMARY KEY,
  data_id VARCHAR(255) NOT NULL,
  group_id VARCHAR(128) DEFAULT NULL,
  content TEXT NOT NULL,
  md5 VARCHAR(32) DEFAULT NULL,
  gmt_create TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  src_user TEXT,
  src_ip VARCHAR(50) DEFAULT NULL,
  app_name VARCHAR(128) DEFAULT NULL,
  tenant_id VARCHAR(128) DEFAULT '',
  c_desc VARCHAR(256) DEFAULT NULL,
  c_use VARCHAR(64) DEFAULT NULL,
  effect VARCHAR(64) DEFAULT NULL,
  type VARCHAR(64) DEFAULT NULL,
  c_schema TEXT,
  encrypted_data_key TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX uk_configinfo_datagrouptenant ON config_info (data_id, group_id, tenant_id);

CREATE TABLE config_info_aggr (
  id BIGSERIAL PRIMARY KEY,
  data_id VARCHAR(255) NOT NULL,
  group_id VARCHAR(128) NOT NULL,
  datum_id VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  gmt_modified TIMESTAMP NOT NULL,
  app_name VARCHAR(128) DEFAULT NULL,
  tenant_id VARCHAR(128) DEFAULT ''
);
CREATE UNIQUE INDEX uk_configinfoaggr_datagrouptenantdatum
  ON config_info_aggr (data_id, group_id, tenant_id, datum_id);

CREATE TABLE config_info_beta (
  id BIGSERIAL PRIMARY KEY,
  data_id VARCHAR(255) NOT NULL,
  group_id VARCHAR(128) NOT NULL,
  app_name VARCHAR(128) DEFAULT NULL,
  content TEXT NOT NULL,
  beta_ips VARCHAR(1024) DEFAULT NULL,
  md5 VARCHAR(32) DEFAULT NULL,
  gmt_create TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  src_user TEXT,
  src_ip VARCHAR(50) DEFAULT NULL,
  tenant_id VARCHAR(128) DEFAULT '',
  encrypted_data_key TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX uk_configinfobeta_datagrouptenant
  ON config_info_beta (data_id, group_id, tenant_id);

CREATE TABLE config_info_tag (
  id BIGSERIAL PRIMARY KEY,
  data_id VARCHAR(255) NOT NULL,
  group_id VARCHAR(128) NOT NULL,
  tenant_id VARCHAR(128) DEFAULT '',
  tag_id VARCHAR(128) NOT NULL,
  app_name VARCHAR(128) DEFAULT NULL,
  content TEXT NOT NULL,
  md5 VARCHAR(32) DEFAULT NULL,
  gmt_create TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  src_user TEXT,
  src_ip VARCHAR(50) DEFAULT NULL
);
CREATE UNIQUE INDEX uk_configinfotag_datagrouptenanttag
  ON config_info_tag (data_id, group_id, tenant_id, tag_id);

CREATE TABLE config_tags_relation (
  id BIGINT NOT NULL,
  tag_name VARCHAR(128) NOT NULL,
  tag_type VARCHAR(64) DEFAULT NULL,
  data_id VARCHAR(255) NOT NULL,
  group_id VARCHAR(128) NOT NULL,
  tenant_id VARCHAR(128) DEFAULT '',
  nid BIGSERIAL PRIMARY KEY
);
CREATE UNIQUE INDEX uk_configtagrelation_configidtag
  ON config_tags_relation (id, tag_name, tag_type);
CREATE INDEX idx_tenant_id ON config_tags_relation (tenant_id);

CREATE TABLE group_capacity (
  id BIGSERIAL PRIMARY KEY,
  group_id VARCHAR(128) NOT NULL DEFAULT '',
  quota INTEGER NOT NULL DEFAULT 0,
  usage INTEGER NOT NULL DEFAULT 0,
  max_size INTEGER NOT NULL DEFAULT 0,
  max_aggr_count INTEGER NOT NULL DEFAULT 0,
  max_aggr_size INTEGER NOT NULL DEFAULT 0,
  max_history_count INTEGER NOT NULL DEFAULT 0,
  gmt_create TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_group_id ON group_capacity (group_id);

CREATE TABLE his_config_info (
  id BIGINT NOT NULL,
  nid BIGSERIAL PRIMARY KEY,
  data_id VARCHAR(255) NOT NULL,
  group_id VARCHAR(128) NOT NULL,
  app_name VARCHAR(128) DEFAULT NULL,
  content TEXT NOT NULL,
  md5 VARCHAR(32) DEFAULT NULL,
  gmt_create TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  src_user TEXT,
  src_ip VARCHAR(50) DEFAULT NULL,
  op_type CHAR(10) DEFAULT NULL,
  tenant_id VARCHAR(128) DEFAULT '',
  encrypted_data_key TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_gmt_create ON his_config_info (gmt_create);
CREATE INDEX idx_gmt_modified ON his_config_info (gmt_modified);
CREATE INDEX idx_did ON his_config_info (data_id);

CREATE TABLE tenant_capacity (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR(128) NOT NULL DEFAULT '',
  quota INTEGER NOT NULL DEFAULT 0,
  usage INTEGER NOT NULL DEFAULT 0,
  max_size INTEGER NOT NULL DEFAULT 0,
  max_aggr_count INTEGER NOT NULL DEFAULT 0,
  max_aggr_size INTEGER NOT NULL DEFAULT 0,
  max_history_count INTEGER NOT NULL DEFAULT 0,
  gmt_create TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  gmt_modified TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_tenant_id ON tenant_capacity (tenant_id);

CREATE TABLE tenant_info (
  id BIGSERIAL PRIMARY KEY,
  kp VARCHAR(128) NOT NULL,
  tenant_id VARCHAR(128) DEFAULT '',
  tenant_name VARCHAR(128) DEFAULT '',
  tenant_desc VARCHAR(256) DEFAULT NULL,
  create_source VARCHAR(32) DEFAULT NULL,
  gmt_create BIGINT NOT NULL,
  gmt_modified BIGINT NOT NULL
);
CREATE UNIQUE INDEX uk_tenant_info_kptenantid ON tenant_info (kp, tenant_id);
CREATE INDEX idx_tenant_info_tenant_id ON tenant_info (tenant_id);

CREATE TABLE users (
  username VARCHAR(50) NOT NULL PRIMARY KEY,
  password VARCHAR(500) NOT NULL,
  enabled BOOLEAN NOT NULL
);

CREATE TABLE roles (
  username VARCHAR(50) NOT NULL,
  role VARCHAR(50) NOT NULL
);
CREATE UNIQUE INDEX idx_user_role ON roles (username, role);

CREATE TABLE permissions (
  role VARCHAR(50) NOT NULL,
  resource VARCHAR(128) NOT NULL,
  action VARCHAR(8) NOT NULL
);
CREATE UNIQUE INDEX uk_role_permission ON permissions (role, resource, action);

INSERT INTO users (username, password, enabled)
VALUES ('nacos', '$2a$10$EuWPZHzz32dJN7jexM34MOeYirDdFAZm2kuWj7VEOJhhZkDrxfvUu', TRUE)
ON CONFLICT (username) DO NOTHING;

INSERT INTO roles (username, role) VALUES ('nacos', 'ROLE_ADMIN');
