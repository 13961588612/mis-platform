# mis-admin-bff 外置日志配置

- 应用目录：`/usr/local/app/mis-admin-bff/`（JAR + `logback-spring.xml`）
- JWT 密钥：**多服务共享**，固定 **`/usr/local/app/keys/`**

```bash
JWT_PUBLIC_KEY_PATH=/usr/local/app/keys/public.pem
MIS_JWT_PRIVATE_KEY_PATH=/usr/local/app/keys/private.pem   # 仅 auth / 嵌入兑换需要
```
