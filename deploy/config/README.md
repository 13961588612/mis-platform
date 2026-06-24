# 微服务外部配置文件

按环境分目录；与仓库内各服务 `application-{profile}.yml` 的 `spring.config.import` 配合使用。

## 目录说明

| 目录 | 环境 | 微服务是否连 Nacos |
|------|------|-------------------|
| `prod/` | 正式 | **否**（唯一配置来源） |
| `test/` | 测试 | 默认否；`NACOS_CONFIG_ENABLED=true` 时可叠加 Nacos |

## 文件命名

| 文件 | 作用 |
|------|------|
| `mis-common.yaml` | 共享：数据源、Redis、JWT 公钥路径等 |
| `mis-gateway.yaml` | 网关路由、JWT 开关 |
| `mis-auth.yaml` | 认证：私钥路径、验证码、TTL |
| `{spring.application.name}.yaml` | 各服务专属配置 |

## 启动示例

```bash
# 正式
export SPRING_PROFILES_ACTIVE=prod
export MIS_CONFIG_HOME=/etc/mis/config    # 本目录 prod/ 的内容

# 测试 · 纯文件
export SPRING_PROFILES_ACTIVE=test
export MIS_CONFIG_HOME=./deploy/config/test
```

## 新服务接入

1. 复制 [bootstrap-template.yml](bootstrap-template.yml) 到服务 `src/main/resources/bootstrap.yml`
2. 添加 `application-prod.yml`、`application-test.yml`（参考 mis-gateway）
3. 在本目录 `prod/`、`test/` 及 `deploy/nacos/import/` 各增一份 `{service}.yaml`

完整说明：[docs/devops/configuration.md](../../docs/devops/configuration.md)
