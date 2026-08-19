"""
FastAPI 应用入口。

初始化 Agent Core 后端服务，包含：
- 结构化 JSON 日志（structlog）
- CORS 中间件
- 健康检查端点
- API 路由注册（后续任务中扩展）
- 后台服务的启动/关闭生命周期管理
"""

from __future__ import annotations
from typing import Any

import asyncio
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator

import redis.asyncio as aioredis
import structlog
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from sqlalchemy.ext.asyncio import AsyncEngine

from src.agent.manager import AgentManager
from src.config import Settings, get_settings
from src.config_manager.manager import ConfigManager
from src.hitl.approval import ApprovalManager
from src.llm.gateway import LLMGateway
from src.push.scheduler import PushScheduler
from src.router.agent_router import AgentRouter
from src.utils.logging import configure_logging

# ===== 生命周期管理 =====


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """
    应用生命周期上下文管理器。

    处理后台服务的启动和关闭，包括：
    - 数据库连接池初始化
    - Redis 连接
    - Qdrant 客户端
    - APScheduler（推送调度、记忆遗忘）
    - ConfigWatcher（热重载）
    """
    settings: Settings = get_settings()
    logger: structlog.stdlib.BoundLogger = structlog.get_logger("lifespan")

    # 多 Agent Core 协调态（T8 / 决策 1 + 同构问题②）：未注入时退化为单 Core 旧行为。
    core_id: str = ""
    core_ownership: Any = None
    cluster_redis: Any = None
    resync_task: Any = None

    logger.info(
        "Application starting",
        app_name=settings.APP_NAME,
        version=settings.APP_VERSION,
        environment=settings.ENVIRONMENT.value,
    )

    # --- 启动阶段 ---
    # 初始化数据库
    from src.db.session import close_db, init_db

    try:
        await init_db()
        logger.info("Database initialized")
    except Exception as exc:
        logger.warning("Database init deferred", error=str(exc))

    # 初始化 LLM Gateway
    from src.llm.gateway import get_llm_gateway

    try:
        gateway: LLMGateway = get_llm_gateway()
        gateway.initialize()
        logger.info("LLM Gateway initialized")
    except Exception as exc:
        logger.warning("LLM Gateway init deferred", error=str(exc))

    # 注册 Agent 运行时工厂（OpenHarness 等）
    try:
        from src.runtime.factory import register_default_runtimes

        register_default_runtimes()
        logger.info("Runtime factories registered")
    except Exception as exc:
        logger.warning("Runtime factory registration deferred", error=str(exc))

    # 初始化 ConfigManager
    from src.config_manager.manager import get_config_manager

    try:
        config_manager: ConfigManager = get_config_manager()
        await config_manager.initialize()
        logger.info("ConfigManager initialized")

        # 注册配置变更回调以更新 AgentRouter
        from src.router.agent_router import get_agent_router

        router: AgentRouter = get_agent_router()

        async def on_config_change(agent_id: str, change_type: str, config: Any) -> None:
            """配置变更时更新 AgentRouter 候选列表与 Worker 目录。"""
            if change_type == "deleted":
                router.remove_candidate(agent_id)
            elif config is not None:
                router.add_candidate(config)
            # Coordinator–Worker：配置热更新后重建 Worker 目录，
            # 新会话构建工具注册表时即刻生效（design-impl.md §8 Q12）。
            try:
                from src.coordinator.catalog import refresh_worker_catalog

                refresh_worker_catalog()
            except Exception as exc:  # noqa: BLE001 - 目录刷新失败不影响配置生效
                logger.warning("Worker catalog refresh failed", error=str(exc))

        config_manager.on_config_change(on_config_change)

        # 设置初始路由候选项
        configs: dict[str, Any] = config_manager.list_configs()
        router.set_candidates(configs)
        logger.info("AgentRouter candidates set", count=len(configs))
    except Exception as exc:
        logger.warning("ConfigManager init deferred", error=str(exc))

    # 初始化 PushScheduler
    try:
        from src.push.scheduler import get_push_scheduler

        push_scheduler: PushScheduler = get_push_scheduler()
        await push_scheduler.start()
        logger.info("PushScheduler started")
    except Exception as exc:
        logger.warning("PushScheduler init deferred", error=str(exc))

    # 初始化 HITL 审批超时检查器
    try:
        from src.hitl.approval import get_approval_manager

        approval_manager: ApprovalManager = get_approval_manager()
        # 执行初始超时检查
        await approval_manager.check_timeouts()
        logger.info("HITL ApprovalManager initialized")
    except Exception as exc:
        logger.warning("HITL ApprovalManager init deferred", error=str(exc))

    # 从配置文件初始化 Skills 注册表和 MCP 管理器
    try:
        from src.bootstrap.skills_mcp import initialize_skills_and_mcp

        skills_mcp_stats: dict[str, Any] = await initialize_skills_and_mcp()
        logger.info("Skills and MCP initialized", **skills_mcp_stats)
    except Exception as exc:
        logger.warning("Skills/MCP init deferred", error=str(exc))

    # ===== AgentManager / ConfigManager（Core 租约与 sync 共用）=====
    from src.agent.manager import get_agent_manager
    from src.config_manager.manager import get_config_manager
    from src.llm.gateway import get_llm_gateway

    agent_manager: AgentManager = get_agent_manager()
    config_manager: ConfigManager = get_config_manager()

    # ===== 多 Agent Core 协调（T8 / 决策 1 + 同构问题②）=====
    # 稳定 CoreId + agent 运行时租约 + Agent 注册表心跳。未注入 CoreOwnership 时
    # AgentManager.sync_from_configs 退化为「人人都起」（向后兼容单 Core）。
    try:
        from src.cluster.core_ownership import CoreOwnership, get_core_id

        core_id = get_core_id()
        cluster_redis = aioredis.from_url(
            settings.redis_url,
            max_connections=settings.REDIS_MAX_CONNECTIONS,
            decode_responses=True,
            socket_timeout=10,
            socket_connect_timeout=5,
        )
        core_ownership = CoreOwnership(
            cluster_redis,
            core_id,
            lease_ttl_s=settings.AGENT_LEASE_TTL_S,
            heartbeat_s=settings.AGENT_HEARTBEAT_S,
        )
        agent_manager.bind_core(core_id, core_ownership, cluster_redis)
        # 心跳：续租持有中的 agent 租约；续租失败（已易主）触发 on_lost 停本地运行时。
        core_ownership.start_heartbeat(
            on_lost=lambda aid: asyncio.create_task(
                agent_manager.stop_agent_if_owned(aid)
            )
        )
        # 注册表心跳：周期刷新 aip:agent:registry 本 core 拥有的 agent 条目。
        agent_manager.start_registry_heartbeat(interval_s=settings.AGENT_HEARTBEAT_S)
        logger.info("Core ownership started", core_id=core_id)
    except Exception as exc:
        logger.warning("Core ownership init deferred", error=str(exc))
        # 避免 CoreOwnership 半初始化导致 inbound worker 订阅 agent 流但从未 claim。
        core_ownership = None
        cluster_redis = None
        core_id = ""

    # 同步从已加载配置中同步 Agent 实例（Skills/MCP 必须先就绪）
    try:
        agent_manager.set_llm_gateway(get_llm_gateway())
        synced: int = await agent_manager.sync_from_configs(config_manager.list_configs())
        logger.info("Agents synced from configs", count=synced)
    except Exception as exc:
        logger.warning("Agent sync deferred", error=str(exc))

    # 启动 Redis Stream 入站消费者（Gateway → Agent Core）
    try:
        from src.queue.inbound_worker import start_inbound_stream_worker

        agent_ids: list[Any] = [inst.id for inst in agent_manager.list_agents()]
        # 多 Core：入站 worker 绑定 Core 身份 + 租约协调器，启用 Redis 分布式
        # session 锁与 agent owner 路由（T9 / 同构问题①）。未绑定则退化为进程内
        # 锁 + 全量订阅（向后兼容单 Core）。
        if core_ownership is not None:
            try:
                from src.queue.inbound_worker import get_inbound_stream_worker

                get_inbound_stream_worker().bind_core(
                    core_id, core_ownership, cluster_redis
                )
            except Exception as exc:
                logger.warning("Inbound worker core binding deferred", error=str(exc))
        await start_inbound_stream_worker(agent_ids)
        logger.info("Inbound stream worker started", agent_streams=agent_ids)
    except Exception as exc:
        logger.warning("Inbound stream worker start deferred", error=str(exc))

    # 多 Core 故障转移再对齐循环（T9 收口 / QA 缺口闭环）：
    # 周期性重跑 sync_from_configs（重认领崩溃 Core 遗留的 agent 租约并起本地运行时）
    # + refresh_streams（重新订阅本 core 新拥有的 aip:stream:agent:{agentId}）。
    # 间隔须 < 租约 TTL，使故障 Core 的 agent 在租约过期后一个窗口内被新 owner 接管并
    # 及时消费 Gateway 直达 agent 流的消息（否则在接管窗口存在订阅缺口）。单 Core（无
    # core_ownership）不启用，退化为「启动一次性 sync_from_configs」旧行为。
    if core_ownership is not None:

        async def _agent_resync_loop() -> None:
            """周期性再对齐 agent 租约运行权与入站流订阅（多 Core 故障转移兜底）。"""
            from src.queue.inbound_worker import get_inbound_stream_worker

            while True:
                try:
                    await asyncio.sleep(settings.AGENT_RESYNC_S)
                    # 重认领孤儿租约 + 起本 core 新拥有的 agent 运行时 + 刷注册表。
                    await agent_manager.sync_from_configs(
                        config_manager.list_configs()
                    )
                    # 重新订阅本 core 拥有的 agent 流（崩溃 Core 易主后及时接管）。
                    worker: Any = get_inbound_stream_worker()
                    await worker.refresh_streams(
                        [inst.id for inst in agent_manager.list_agents()]
                    )
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # noqa: BLE001 - 再对齐失败不得中断循环
                    logger.warning("Agent resync iteration failed", error=str(exc))

        try:
            resync_task = asyncio.create_task(
                _agent_resync_loop(), name="agent-resync-loop"
            )
            logger.info(
                "Agent resync loop started",
                interval_s=settings.AGENT_RESYNC_S,
                lease_ttl_s=settings.AGENT_LEASE_TTL_S,
            )
        except Exception as exc:
            logger.warning("Agent resync loop start deferred", error=str(exc))

    logger.info("Startup phase complete")

    yield

    # --- 关闭阶段 ---
    logger.info("Application shutting down")

    # 先取消 agent 故障转移再对齐循环（T9 收口），避免其在拆除 worker / 释放租约期间
    # 再触发 sync_from_configs / refresh_streams 产生竞态。
    try:
        if resync_task is not None:
            resync_task.cancel()
            try:
                await resync_task
            except asyncio.CancelledError:
                pass
            logger.info("Agent resync loop stopped")
    except Exception as exc:
        logger.warning("Agent resync loop shutdown error", error=str(exc))

    try:
        from src.queue.inbound_worker import stop_inbound_stream_worker

        await stop_inbound_stream_worker()
    except Exception as exc:
        logger.warning("Inbound stream worker shutdown error", error=str(exc))

    # 停止 Agent 注册表心跳 + 释放本 core 持有的 agent 租约 + 停 Core 租约心跳
    try:
        from src.agent.manager import get_agent_manager

        get_agent_manager().stop_registry_heartbeat()
        await get_agent_manager().release_all_leases()
    except Exception as exc:
        logger.warning("Agent registry/lease shutdown error", error=str(exc))
    try:
        if core_ownership is not None:
            core_ownership.stop_heartbeat()
    except Exception as exc:
        logger.warning("Core ownership shutdown error", error=str(exc))
    try:
        if cluster_redis is not None:
            await cluster_redis.aclose()
    except Exception:
        pass

    try:
        from src.bootstrap.skills_mcp import shutdown_skills_and_mcp

        await shutdown_skills_and_mcp()
    except Exception as exc:
        logger.warning("Skills/MCP shutdown error", error=str(exc))

    # 关闭 PushScheduler
    try:
        from src.push.scheduler import get_push_scheduler

        await get_push_scheduler().stop()
    except Exception as exc:
        logger.warning("PushScheduler shutdown error", error=str(exc))

    # 关闭 ConfigManager（停止 ConfigWatcher）
    try:
        from src.config_manager.manager import get_config_manager

        await get_config_manager().shutdown()
    except Exception as exc:
        logger.warning("ConfigManager shutdown error", error=str(exc))

    # 关闭所有 Agent 实例
    try:
        from src.agent.manager import get_agent_manager

        await get_agent_manager().shutdown_all()
    except Exception as exc:
        logger.warning("AgentManager shutdown error", error=str(exc))

    # 关闭数据库连接
    try:
        await close_db()
    except Exception as exc:
        logger.warning("Database close error", error=str(exc))

    logger.info("Shutdown complete")


# ===== 应用工厂 =====


def create_app() -> FastAPI:
    """创建并配置 FastAPI 应用实例。"""
    settings: Settings = get_settings()

    # 配置日志
    configure_logging()

    app: FastAPI = FastAPI(
        title="AI Platform — Agent Core",
        description=(
            "企业内部 AI 平台后端服务 — "
            "Agent 生命周期管理、智能路由、LLM 网关、Skills 调度"
        ),
        version=settings.APP_VERSION,
        docs_url="/docs" if not settings.is_production else None,
        redoc_url="/redoc" if not settings.is_production else None,
        openapi_url="/openapi.json" if not settings.is_production else None,
        lifespan=lifespan,
    )

    # ===== CORS =====
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ===== Trace ID 中间件 =====
    @app.middleware("http")
    async def add_trace_id(request: Request, call_next: Any) -> Any:
        """为每个请求注入 traceId 以支持分布式追踪。"""
        import uuid

        trace_id: str = request.headers.get("X-Trace-Id", str(uuid.uuid4()))
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(
            trace_id=trace_id,
            service=settings.APP_NAME,
        )
        response: Any = await call_next(request)
        response.headers["X-Trace-Id"] = trace_id
        return response

    # ===== 健康检查端点 =====
    @app.get("/health", tags=["system"])
    async def health_check() -> dict[str, str]:
        """存活探针 —— 若进程运行中则返回 200。"""
        return {"status": "ok", "service": settings.APP_NAME}

    @app.get("/ready", tags=["system"])
    async def readiness_check() -> JSONResponse:
        """
        就绪探针 —— 检查依赖项连接性。

        若所有依赖项（PostgreSQL、Redis、Qdrant）均可达则返回 200；
        否则返回 503。
        """
        checks: dict[str, str] = {}
        all_healthy: bool = True

        # PostgreSQL 检查
        try:
            from sqlalchemy import text

            from src.db.session import get_engine

            engine: AsyncEngine = get_engine()
            async with engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            checks["postgres"] = "ok"
        except Exception:
            checks["postgres"] = "error"
            all_healthy: bool = False

        # Redis 检查
        try:
            import redis.asyncio as aioredis

            redis_client: Any = aioredis.from_url(settings.redis_url)
            await redis_client.ping()
            await redis_client.close()
            checks["redis"] = "ok"
        except Exception:
            checks["redis"] = "error"
            all_healthy: bool = False

        # Qdrant 检查
        try:
            from qdrant_client import QdrantClient

            qdrant: QdrantClient = QdrantClient(url=settings.qdrant_url)
            qdrant.get_collections()
            checks["qdrant"] = "ok"
        except Exception:
            checks["qdrant"] = "error"
            all_healthy: bool = False

        http_status: Any = (
            status.HTTP_200_OK if all_healthy else status.HTTP_503_SERVICE_UNAVAILABLE
        )
        return JSONResponse(
            status_code=http_status,
            content={
                "status": "ready" if all_healthy else "not_ready",
                "checks": checks,
            },
        )

    # ===== API 路由 =====
    from src.api.routes.admin import router as admin_router
    from src.api.routes.agent import router as agent_router
    from src.api.routes.agent_config_files import router as agent_config_files_router
    from src.api.routes.auth import router as auth_router
    from src.api.routes.channels import router as channels_router
    from src.api.routes.files import router as files_router
    from src.api.routes.mcp import router as mcp_router
    from src.api.routes.mis_capability import router as mis_capability_router
    from src.api.routes.push import router as push_router
    from src.api.routes.session import router as session_router
    from src.api.routes.skill import router as skill_router

    app.include_router(agent_router, prefix="/api/v1")
    app.include_router(agent_config_files_router, prefix="/api/v1")
    app.include_router(auth_router, prefix="/api/v1")
    app.include_router(session_router, prefix="/api/v1")
    # T04 O1f：企微多 Bot 管理（#48–#54），BFF /agent-ops/channels/** 透传至此
    app.include_router(channels_router, prefix="/api/v1")
    app.include_router(files_router, prefix="/api/v1")
    app.include_router(skill_router, prefix="/api/v1/skills", tags=["skills"])
    app.include_router(mcp_router, prefix="/api/v1/mcp", tags=["mcp"])
    app.include_router(admin_router, prefix="/api/v1")
    app.include_router(push_router, prefix="/api/v1")
    # 阶段1 认证对齐：受 MIS RS256 保护的业务能力端点（供 BFF 适配层调用）
    app.include_router(mis_capability_router, prefix="/api/v1")

    # ===== 统一 API 响应格式 =====
    # 所有 API 响应遵循：{ code, data, message, traceId }

    return app


# ===== 创建应用实例 =====
app = create_app()


def main() -> None:
    """使用 uvicorn 运行应用（用于直接 python 执行）。"""
    import uvicorn

    settings: Settings = get_settings()
    uvicorn.run(
        "src.main:app",
        host=settings.HOST,
        port=settings.PORT,
        workers=settings.WORKERS if not settings.DEBUG else 1,
        reload=settings.RELOAD,
        log_level=settings.LOG_LEVEL.value.lower(),
    )


if __name__ == "__main__":
    main()
