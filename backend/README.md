# MIS Platform — 后端

Java 17 + Maven 多模块。Sprint 0 已包含：`mis-migrator`、`mis-common-bom`、`mis-common-core`、`mis-common-jpa`、`mis-gateway`。

持久层：**Spring Data JPA**（见 [ADR-015](../docs/adr/ADR-015-jpa-over-mybatis.md)）。

## 模块结构

```
backend/
├── pom.xml
├── config/
│   ├── jdk.properties.example   # 可选，覆盖 JDK17_HOME
│   └── jdk.properties           # 本地覆盖（gitignore）
├── mis-migrator/
├── mis-common/                  # bom + core + jpa
└── mis-gateway/
```

## JDK 17 配置

父 POM 通过 **`${env.JDK17_HOME}`** 绑定 JDK 17，编译 / 测试 / `spring-boot:run` 均使用该路径下的 `javac` / `java`。

### 方式 1：环境变量（推荐）

**Windows（PowerShell，当前会话）**

```powershell
$env:JDK17_HOME = "C:\Program Files\Eclipse Adoptium\jdk-17.0.11.9-hotspot"
cd backend
mvn clean package
```

**Windows（系统环境变量，永久）**

```
变量名: JDK17_HOME
变量值: C:\Program Files\Eclipse Adoptium\jdk-17.0.11.9-hotspot
```

**Linux / macOS**

```bash
export JDK17_HOME=/usr/lib/jvm/java-17-openjdk
mvn clean package
```

### 方式 2：命令行覆盖

```bash
mvn -Djdk.home=C:/path/to/jdk-17 clean package
```

### 方式 3：配置文件覆盖（可选）

当本机不便设环境变量时，可复制 `config/jdk.properties.example` 为 `config/jdk.properties` 并设置 `jdk.home`。

### 优先级

```
-Djdk.home  >  config/jdk.properties  >  JDK17_HOME 环境变量
```

POM 中的定义：

```xml
<jdk.home>${env.JDK17_HOME}</jdk.home>
```

## 常用命令

```bash
cd backend
mvn clean package
mvn -pl mis-gateway spring-boot:run
# http://localhost:8080/actuator/health

mvn -pl mis-migrator flyway:migrate
```

## 关联文档

- [mis-migrator](mis-migrator/README.md)
- [本地开发](../docs/devops/local-dev.md)
