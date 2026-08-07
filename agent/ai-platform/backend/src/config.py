"""
全局应用配置。

所有配置均由环境变量驱动，为本地开发提供合理的默认值。
使用 pydantic-settings 实现类型安全、带验证的配置加载，
并自动绑定环境变量。
"""

from __future__ import annotations
from typing import Annotated, Any

from enum import Enum
from functools import lru_cache
from pathlib import Path

from pydantic import BeforeValidator, Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _parse_str_list(v: Any) -> list[str]:
    """解析 list 环境变量：支持 JSON 数组、逗号分隔，或已是 list。"""
    if v is None or v == "":
        return []
    if isinstance(v, list):
        return [str(x).strip() for x in v if str(x).strip()]
    if isinstance(v, str):
        s = v.strip()
        if s.startswith("["):
            import json

            parsed = json.loads(s)
            if isinstance(parsed, list):
                return [str(x).strip() for x in parsed if str(x).strip()]
        return [part.strip() for part in s.split(",") if part.strip()]
    return v


class Environment(str, Enum):
    """部署环境标识符。"""

    DEVELOPMENT = "development"
    STAGING = "staging"
    PRODUCTION = "production"


class LogLevel(str, Enum):
    """结构化日志级别。"""

    DEBUG = "DEBUG"
    INFO = "INFO"
    WARNING = "WARNING"
    ERROR = "ERROR"
    FATAL = "FATAL"


class Settings(BaseSettings):
    """
    应用全局设置，从环境变量中加载。

    所有设置都有适用于 Docker Compose 中本地开发的默认值。
    生产环境中请通过环境变量或 .env 文件覆盖。
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ===== 应用 =====
    APP_NAME: str = "ai-platform-backend"
    APP_VERSION: str = "1.0.0"
    ENVIRONMENT: Environment = Environment.DEVELOPMENT
    DEBUG: bool = True
    LOG_LEVEL: LogLevel = LogLevel.INFO
    LOG_FORMAT: str = "json"
    LOG_FILE: str = Field(
        default="logs/backend.log",
        description="日志文件路径；设为空字符串则仅输出到控制台",
    )
    LOG_MAX_BYTES: int = Field(
        default=10_485_760,
        description="单个日志文件最大字节数（默认 10MB）",
    )
    LOG_BACKUP_COUNT: int = Field(
        default=5,
        description="日志轮转保留的历史文件数量",
    )
    AGENT_TRACE_LOG: bool = True
    AGENT_MESSAGE_TIMEOUT: int = Field(
        default=120,
        description="单条入站消息 Agent 处理超时（秒），超时后向前端推送 error + done",
    )
    MCP_TOOL_CALL_TIMEOUT: int = Field(
        default=30,
        description="单次 MCP 工具调用超时（秒）",
    )

    # ===== 服务器 =====
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    WORKERS: int = 1
    RELOAD: bool = False
    CORS_ORIGINS: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
            "http://localhost:80",
            "http://nginx",
        ]
    )

    # ===== 聊天附件（本地盘，无需公网 URL）=====
    UPLOAD_DIR: str = Field(
        default="data/uploads",
        description="聊天附件本地存储目录（相对 cwd 或绝对路径）",
    )
    UPLOAD_MAX_BYTES: int = Field(
        default=10 * 1024 * 1024,
        description="单文件上传大小上限（字节）",
    )

    # ===== PostgreSQL =====
    POSTGRES_HOST: str = "postgres"
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str = "aiplatform"
    POSTGRES_PASSWORD: str = "aiplatform_dev_password"
    POSTGRES_DB: str = "ai_platform"
    POSTGRES_POOL_SIZE: int = 20
    POSTGRES_MAX_OVERFLOW: int = 10
    POSTGRES_POOL_TIMEOUT: int = 30
    POSTGRES_POOL_RECYCLE: int = 3600

    # ===== Redis =====
    REDIS_HOST: str = "redis"
    REDIS_PORT: int = 6379
    # 融合部署：与 MIS 共享同一 Redis 实例，agent 走独立 db index(2) 做物理隔离
    REDIS_DB: int = 2
    REDIS_PASSWORD: str = ""
    REDIS_MAX_CONNECTIONS: int = 50
    # agent Redis 键统一命名空间前缀（与 TS gateway 端 ioredis 约定的 `aip:` 一致）。
    # db index 已做物理隔离，前缀为可读性 / 误操作兜底的二层保险，杜绝与 MIS(`mis:`)键冲突。
    REDIS_KEY_PREFIX: str = "aip:"

    # ===== Redis Streams（Gateway ↔ Agent Core） =====
    STREAM_CONSUMER_ENABLED: bool = Field(
        default=True,
        description="是否启动 Redis Stream 入站消息消费者",
    )
    STREAM_CONSUMER_GROUP: str = "agent-core-group"
    INBOUND_MAX_CONCURRENCY: int = Field(
        default=8,
        description="进程内同时处理的入站消息上限（不同 session 可并行）",
    )
    INBOUND_READ_COUNT: int = Field(
        default=4,
        description="每次 XREADGROUP 最多读取的消息条数",
    )

    # ===== Qdrant =====
    QDRANT_HOST: str = "qdrant"
    QDRANT_PORT: int = 6333
    QDRANT_API_KEY: str = ""
    QDRANT_COLLECTION_SKILLS: str = "skills_index"
    QDRANT_COLLECTION_AGENT_ROUTER: str = "agent_router_index"
    QDRANT_COLLECTION_AGENT_MEMORY: str = "agent_memory_index"
    QDRANT_VECTOR_SIZE: int = 512

    # ===== 嵌入模型 =====
    EMBEDDING_SERVICE_URL: str = "http://embedding:8001"
    EMBEDDING_MODEL_NAME: str = "bge-small-zh-v1.5"
    EMBEDDING_DIMENSION: int = 512
    EMBEDDING_TIMEOUT_SECONDS: float = Field(
        default=15.0,
        description="调用 Embedding 服务的超时（秒）",
    )
    SKILL_VECTOR_INDEX_ENABLED: bool = Field(
        default=True,
        description="是否在注册 Skill 时写入 Qdrant 向量索引；本地无 embedding 服务时可关",
    )

    # ===== LLM Gateway =====
    # 默认主用 Qwen（工具调用 + 可选 VL 识图）；DeepSeek 作故障转移备用
    LLM_GATEWAY_ENABLED: bool = True
    LLM_PRIMARY_PROVIDER: str = "qwen"
    LLM_FALLBACK_PROVIDER: str = "deepseek"
    LLM_PRIMARY_MODEL: str = "qwen3.6-plus"
    LLM_FALLBACK_MODEL: str = "deepseek-v4-flash"
    LLM_REQUEST_TIMEOUT: int = 60
    LLM_MAX_RETRIES: int = 3
    LLM_FAILOVER_AUTO_SWITCH: bool = True

    # DeepSeek API
    DEEPSEEK_API_KEY: str = ""
    DEEPSEEK_API_ENDPOINT: str = "https://api.deepseek.com/v1"

    # Qwen API（须用 compatible-mode，与 OpenAI SDK 对齐）
    QWEN_API_KEY: str = ""
    QWEN_API_ENDPOINT: str = "https://dashscope.aliyuncs.com/compatible-mode/v1"

    # ===== 出站代理 =====
    OUTBOUND_PROXY_ENABLED: bool = True
    OUTBOUND_PROXY_HOST: str = "outbound-proxy"
    OUTBOUND_PROXY_PORT: int = 3128
    OUTBOUND_PROXY_ALLOWED_DOMAINS: Annotated[list[str], NoDecode, BeforeValidator(_parse_str_list)] = Field(
        default_factory=lambda: [
            "api.deepseek.com",
            "dashscope.aliyuncs.com",
        ],
        description="额外允许的 LLM 出站域名/IP；.env 中的 QWEN/DEEPSEEK 端点会自动加入白名单",
    )

    # ===== JWT / 认证 =====
    JWT_SECRET_KEY: str = "dev-secret-key-change-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ===== MIS 身份信任（阶段1：认证对齐）=====
    # MIS 使用 RS256（RSA 公钥）签发 JWT；平台用同一公钥验签。
    # 公钥优先用内联 PEM（MIS_JWT_PUBLIC_KEY_PEM），其次用文件路径
    # （MIS_JWT_PUBLIC_KEY_PATH，生产期由 K8s Secret 挂载注入）。
    # 默认指向仓库内 backend/keys/public.pem，本地开发免复制即可跑通。
    MIS_JWT_PUBLIC_KEY_PEM: str = ""
    MIS_JWT_PUBLIC_KEY_PATH: str = str(
        Path(__file__).resolve().parents[4] / "backend" / "keys" / "public.pem"
    )
    MIS_JWT_ISSUER: str = "mis-platform"  # 期望 iss；如 MIS 未设 iss 则置空跳过校验
    # iss 强校验开关（T3）：True=强校验（iss 必须存在且等于 MIS_JWT_ISSUER）；
    # False（默认，向后兼容）= 软比对（仅当 token 携带 iss 且不符时拒）。
    # 启用前需 T1（RsaJwtIssuer 补 .issuer("mis-platform")）已上线。
    MIS_JWT_VERIFY_ISS: bool = Field(
        default=False,
        description="True=强校验 MIS JWT iss 必须存在且等于 MIS_JWT_ISSUER；"
        "False=软比对（仅当 token 携带 iss 且不符时拒）。启用强校验前需 T1 已上线。",
    )
    MIS_JWT_ALGORITHM: str = "RS256"

    # ===== AI Skill / FormFill 反向信任（决策 3：平台侧委托调用 MIS 引擎）=====
    # mis-admin-bff 的 AI Skill 接口地址（AiProxyController）。
    MIS_ADMIN_BFF_BASE_URL: str = "http://mis-admin-bff:8080"
    # 平台 ↔ BFF 共享密钥，作为 X-Platform-Token 标识「这是 ai-platform 自身调用」。
    AI_PLATFORM_BFF_SHARED_SECRET: str = ""
    # 上游 MIS RS256 JWT 的回放头名（与 BFF ReverseTrustInterceptor 对齐）。
    MIS_JWT_REPLAY_HEADER: str = "X-Mis-Upstream-Jwt"
    # P0 允许的 FormFill Skill ID 白名单（意图 → skillId 由工具内部映射）。
    FORMFILL_ALLOWED_SKILLS: list[str] = Field(
        default_factory=lambda: ["user-fill"],
        description="P0 允许触发的 MIS FormFill 引擎 Skill ID 白名单",
    )

    # ===== T03 fail-closed 权限闸门（E1–E5 Python 侧）=====
    # 端用户 Skill 执行权限码来源：mis-admin-bff GET /internal/permissions。
    # 语义硬约束：未授权 / 匿名 / 码集合为空 / 权限源不可达 → 一律拒绝，绝不 fallback 放行。
    MIS_ACL_ENABLED: bool = Field(
        default=True,
        description="T03 权限闸门总开关；False 仅用于本地联调，生产必须 True",
    )
    # 权限码缓存 key 前缀，与 Java 侧 mis:acl:skillperm:{userId} 逐字节对齐（跨语言共享）。
    # ⚠ 刻意不带 REDIS_KEY_PREFIX（aip:），否则与 Java 侧缓存分裂。
    MIS_ACL_CACHE_KEY_PREFIX: str = "mis:acl:skillperm:"
    # 缓存 TTL（秒）；与 impl-plan.md §6.2 / §8.3 及 Java 侧一致。
    MIS_ACL_CACHE_TTL: int = 300
    # 回源 BFF 的 HTTP 超时（秒）；超时 → PermissionUnavailable → fail-closed 拒绝。
    MIS_ACL_HTTP_TIMEOUT: float = 3.0
    # 回源路径（挂在 MIS_ADMIN_BFF_BASE_URL 之下）。
    MIS_ACL_PERMISSIONS_PATH: str = "/internal/permissions"
    # 回源时 appId 入参的默认值（工具执行链路无 JWT，取此默认；REST 链路优先取 ctx.profile["app_id"]）。
    MIS_ACL_DEFAULT_APP_ID: str = ""
    # MCP 工具（E2）在 skill 注册表未命中时的兜底权限码（V22 已落真实码：菜单 92301，
    # App=system，授 role_id=1）。注意与 V20 的运营台操作码 agent:mcp:call 解耦：
    # 运行时执行码 = ai:mcp:call，运营台手动调用码 = agent:mcp:call（Q7 方案 B+）。
    MIS_ACL_MCP_FALLBACK_PERMISSION: str = "ai:mcp:call"
    # 超管豁免角色码；**默认空 = 豁免关闭**（§4.2 规则 4）。显式配置后命中角色方可绕过。
    MIS_ACL_SUPERADMIN_BYPASS_ROLE_CODES: list[str] = Field(
        default_factory=list,
        description="超管豁免角色码白名单；默认空集合表示豁免关闭（fail-closed）",
    )

    # ===== 知识库 mis-kb 对接（T10：mis-rag 内部编排 KB 问答）=====
    # mis-kb 微服务基址；mis-rag 带用户 JWT 调其 /internal/v1/kb/** 内部端点。
    MIS_KB_BASE_URL: str = Field(
        default="http://mis-kb:8108",
        description="mis-kb 服务基址（内网直连，非经 Gateway）",
    )
    # 内部服务账号 JWT：仅当请求未携带用户 JWT 时兜底使用（RS256，iss=mis-platform）。
    MIS_KB_AGENT_TOKEN: str = Field(
        default="",
        description="mis-rag 调 mis-kb 的服务账号令牌；留空表示只透传用户 JWT",
    )
    MIS_KB_TIMEOUT_SECONDS: int = Field(
        default=20,
        description="调用 mis-kb 内部端点的单次超时（秒）",
    )
    MIS_KB_QA_ENABLED: bool = Field(
        default=True,
        description="KB 问答管线总开关；关闭后 mis-rag 退化为纯提示词问答",
    )
    MIS_KB_RETRIEVE_TOP_K: int = Field(
        default=5,
        description="KB 检索默认召回条数（请求未指定 topK 时生效）",
    )
    MIS_KB_SNIPPET_LIMIT: int = Field(
        default=200,
        description="返回给前端的单条引用摘要最大字符数",
    )
    MIS_KB_MAX_CONTEXT_CHARS: int = Field(
        default=6000,
        description="注入提示词的检索上下文总字符上限，防止超出模型窗口",
    )

    # ===== Copilot 调度（agent__invoke）=====
    INVOKE_AGENT_WHITELIST: list[str] = Field(
        default_factory=lambda: [
            "mis-extract",
            "mis-summary",
            "mis-rag",
            "crm-assistant",
        ],
        description="mis-copilot 可委托的目标 Agent 白名单",
    )
    INVOKE_AGENT_MAX_DEPTH: int = Field(
        default=1,
        description="invoke_agent 最大深度（1=仅顶层 Copilot 可委托，禁止递归）",
    )
    INVOKE_AGENT_TIMEOUT_SECONDS: int = Field(
        default=120,
        description="单次子 Agent 委托超时（秒）",
    )

    # ===== Coordinator–Worker 调度基座（C1/C3/C5，design-impl.md §6.2）=====
    DISPATCH_TRACE_ENABLED: bool = Field(
        default=True,
        description="通道 A：委派轨迹写 session.state[\"dispatch_trace\"] + 结构化日志",
    )
    DISPATCH_TRACE_SSE_ENABLED: bool = Field(
        default=False,
        description="通道 B：SSE done 帧附加 dispatchTrace（需 Java BFF 侧确认后再开）",
    )
    DISPATCH_TRACE_EVENT_ENABLED: bool = Field(
        default=True,
        description="通道 C：新增 dispatch.trace AgentEvent（C4 前端就绪，通道 C 已开启）",
    )
    TASK_BRIEF_STRICT: bool = Field(
        default=True,
        description="True（默认）=TaskBrief 校验不通过即拒绝委派；False=只记 warning 并放行（灰度回滚开关）",
    )
    TASK_NOTIFICATION_MODE: str = Field(
        default="text_with_header",
        description="结果信封渲染模式：text_with_header（默认）/ json",
    )
    DELEGATE_TOOL_ALIAS_ENABLED: bool = Field(
        default=False,
        description="是否额外注册 agent 别名（双名过渡）；默认关闭，绝不同时暴露两个工具名",
    )
    INVOKE_AGENT_MAX_PARALLEL: int = Field(
        default=1,
        description="同轮并行 spawn 上限（1=语义等价串行，只读 Worker 才可并行）",
    )
    INVOKE_AGENT_FAILURE_THRESHOLD: int = Field(
        default=3,
        description="单 Worker 连续失败熔断阈值（达到后本会话内短路 60 秒）",
    )
    INVOKE_AGENT_CONTINUE_ENABLED: bool = Field(
        default=False,
        description="是否允许 mode=\"continue\" 复用已有 Worker 子会话（未命中静默降级 spawn）",
    )

    DEV_TEST_ACCOUNTS_ENABLED: bool = Field(
        default=False,
        description="是否启用 configs/test-accounts.yaml 中的测试账号登录",
    )
    TEST_ACCOUNTS_FILE: str = Field(
        default="test-accounts.yaml",
        description="测试账号配置文件（相对 CONFIG_BASE_PATH）",
    )

    # ===== 企业微信 =====
    WECOM_CORP_ID: str = ""
    WECOM_AGENT_ID: str = ""
    WECOM_SECRET: str = ""
    WECOM_ENCODING_AES_KEY: str = ""
    WECOM_TOKEN: str = ""
    WECOM_BOT_CALLBACK_TOKEN: str = ""
    WECOM_BOT_CALLBACK_ENCODING_AES_KEY: str = ""

    # ===== 凭据保险箱（AES-256-GCM） =====
    CREDENTIAL_VAULT_KEY: str = "dev-vault-key-change-in-production-32b!"

    # ===== Gateway 通信 =====
    GATEWAY_HOST: str = "gateway"
    GATEWAY_PORT: int = 3100
    GATEWAY_API_URL: str = "http://gateway:3100"

    # ===== 配置管理器 =====
    CONFIG_MODE: str = "file_system"
    CONFIG_BASE_PATH: str = "/app/configs"
    CONFIG_WATCH_ENABLED: bool = True
    CONFIG_RELOAD_INTERVAL: int = 5

    # ===== 会话持久化（T04 Q1 方案 B：Redis 热 + PG 冷双写）=====
    #: 总开关。关掉后 SessionManager 退回「只写 Redis」的历史行为，
    #: 运营后台的会话列表会读不到新数据 —— 仅在 PG 不可用需要临时降级时关闭。
    SESSION_PG_DUAL_WRITE_ENABLED: bool = True
    #: 单次 save_session 最多向 PG 补写多少条消息（按时间倒序取最近 N 条）。
    #: 消息 id 是稳定 uuid + ``ON CONFLICT DO NOTHING``，重复补写幂等；
    #: 设上限只是为了给单条 INSERT 语句的体积封顶。
    SESSION_PG_MESSAGE_SYNC_LIMIT: int = 500
    #: 会话标题自动截取长度（取首条 user 消息前 N 个字符）。
    SESSION_TITLE_MAX_LENGTH: int = 60

    # ===== 企微多 Bot（T04 Q4 方案 A：配置文件持久化）=====
    #: 相对 CONFIG_BASE_PATH 的企微 Bot 清单文件路径。
    WECOM_BOT_CONFIG_FILE: str = "channels/wecom-bots.yaml"
    #: Gateway ⇄ backend 服务间共享令牌。
    #:
    #: Gateway 启动时需要拉取**含明文 secret** 的 Bot 运行时清单
    #: （``GET /api/v1/channels/wecom/bots/runtime``），该端点不能用普通用户
    #: 身份保护（任何登录用户都能读到明文密钥）。因此用一个独立的服务间
    #: 共享令牌闸门：**留空 = 端点直接 503**（fail-closed），Gateway 自动
    #: 降级为 ``WECOM_BOT_*`` 环境变量单 Bot 模式。
    GATEWAY_INTERNAL_TOKEN: str = ""

    # ===== Agent Router =====
    AGENT_ROUTER_SESSION_AFFINITY_TTL: int = 1800
    AGENT_ROUTER_SEMANTIC_TOP_K: int = 5
    AGENT_ROUTER_DEFAULT_AGENT: str = "default-agent"

    # ===== Skills =====
    SKILLS_RETRIEVAL_TOP_N: int = 50
    SKILLS_RANKING_TOP_K: int = 10
    SKILLS_CACHE_TTL: int = 300
    SKILLS_CACHE_MAX_SIZE: int = 500
    SKILLS_META_CACHE_TTL: int = 3600
    SKILLS_SCHEMA_CACHE_TTL: int = 1800
    SKILLS_FREQ_KEY: str = "skill:freq"
    SKILLS_WARMUP_TOP_N: int = 50

    # ===== 速率限制 =====
    RATE_LIMIT_PER_USER_PER_MINUTE: int = 30
    RATE_LIMIT_PER_DEPARTMENT_PER_MINUTE: int = 200

    # ===== HITL（人机协同） =====
    HITL_APPROVAL_TIMEOUT_SECONDS: int = 300
    HITL_MAX_PENDING_PER_USER: int = 5

    # ===== Agent Memory =====
    AGENT_MEMORY_DYNAMIC_ENABLED: bool = True
    AGENT_MEMORY_TOP_K: int = 5
    AGENT_MEMORY_TTL_DAYS: int = 30
    AGENT_MEMORY_MAX_PER_USER: int = 200

    # ===== APScheduler =====
    SCHEDULER_TIMEZONE: str = "Asia/Shanghai"
    SCHEDULER_JOBSTORE_URL: str = ""

    # ===== Sentry / Tracing（可选） =====
    SENTRY_DSN: str = ""
    JAEGER_AGENT_HOST: str = ""
    JAEGER_AGENT_PORT: int = 6831

    # ===== 属性验证器 =====

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, v: Any) -> list[str]:
        """从逗号分隔字符串或列表中解析 CORS Origins。"""
        if isinstance(v, str):
            return [origin.strip() for origin in v.split(",") if origin.strip()]
        return v

    # ===== 派生属性 =====

    @property
    def postgres_dsn(self) -> str:
        """异步 PostgreSQL 连接字符串。"""
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def postgres_dsn_sync(self) -> str:
        """同步 PostgreSQL 连接字符串（用于 Alembic 迁移）。"""
        return (
            f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
        )

    @property
    def redis_url(self) -> str:
        """Redis 连接 URL。"""
        if self.REDIS_PASSWORD:
            return (
                f"redis://:{self.REDIS_PASSWORD}"
                f"@{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"
            )
        return f"redis://{self.REDIS_HOST}:{self.REDIS_PORT}/{self.REDIS_DB}"

    @property
    def qdrant_url(self) -> str:
        """Qdrant 服务 URL。"""
        return f"http://{self.QDRANT_HOST}:{self.QDRANT_PORT}"

    @property
    def outbound_proxy_url(self) -> str:
        """LLM API 请求的出站代理 URL。"""
        return f"http://{self.OUTBOUND_PROXY_HOST}:{self.OUTBOUND_PROXY_PORT}"

    @property
    def is_production(self) -> bool:
        """检查是否在生产环境中运行。"""
        return self.ENVIRONMENT == Environment.PRODUCTION

    @property
    def is_development(self) -> bool:
        """检查是否在开发环境中运行。"""
        return self.ENVIRONMENT == Environment.DEVELOPMENT


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """
    返回缓存的 Settings 实例。

    使用 lru_cache 确保每个进程仅加载一次配置。
    在应用的任何地方调用 get_settings() 即可访问配置。
    """
    return Settings()
