"""AgentManager — Agent 实例的生命周期管理。

管理 Agent 实例的创建、启动、暂停、恢复、停止和删除。
与 RuntimeRegistry 协调运行时创建，与 SessionManager 协调会话处理。
"""

from __future__ import annotations
from typing import Any

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from src.agent.config import AgentConfig
from src.agent.lifecycle import InstanceState, LifecycleEvent, LifecycleStateMachine
from src.agent.runtime_setup import wire_agent_runtime
from src.agent.session import Message, Session
from src.agent.session_timing import RedisTimingStore, SessionTimingRecorder
from src.cluster.core_ownership import agent_registry_key
from src.config import get_settings
from src.runtime.base import AgentRuntime
from src.runtime.events import AgentEvent, AgentEventType, HealthStatus
from src.runtime.factory import create_runtime
from src.runtime.registry import get_runtime_registry
from src.utils.exceptions import AgentNotFoundError, AgentNotRunningError
from src.utils.logging import get_logger

logger = get_logger("agent.manager")


class AgentInstance:
    """
    一个包含运行时与生命周期状态的运行中 Agent 实例。

    通过委托运行时来处理消息，并追踪活跃会话和健康状态。
    """

    def __init__(self, config: AgentConfig, runtime: AgentRuntime) -> None:
        """创建 Agent 实例包装（状态为 CREATED，运行时待初始化）。

        Args:
            config: Agent 配置。
            runtime: 与此实例绑定的运行时实现。
        """
        self.id: str = config.agent_id
        self.config: AgentConfig = config
        self.runtime: AgentRuntime = runtime
        self.lifecycle: LifecycleStateMachine = LifecycleStateMachine()
        self.started_at: datetime | None = None
        self.active_sessions: int = 0
        self._initialized: bool = False

    async def initialize(self) -> None:
        """使用 Agent 配置初始化运行时。"""
        if not self._initialized:
            await self.runtime.initialize(self.config)
            await wire_agent_runtime(self.runtime, self.config)
            self._initialized = True
            logger.info("Agent instance initialized", agent_id=self.id)

    async def process_message(
        self,
        session: Session,
        message: Message,
        assistant_message_id: str | None = None,
    ) -> AsyncIterator[AgentEvent]:
        """
        处理用户消息并产出 AgentEvent 流。

        Args:
            session: 当前活跃会话。
            message: 要处理的用户消息。
            assistant_message_id: 本轮要落库的 assistant 消息 id（由调用方在
                ``add_message(role="assistant", message_id=...)`` 时复用同一 id）。
                传入后计时按「轮」维度（turn_key=该 id）存入 Redis，前端可按
                ``message.id`` 逐条映射；为 ``None`` 时回退为 session 级单键。

        Yields:
            来自运行时的 AgentEvent 对象。
        """
        if not self.lifecycle.is_active():
            raise AgentNotRunningError(self.id)

        self.active_sessions += 1
        # T01/2.1：包裹计时器，按 wall-clock 切 5 阶段，run_complete 后按轮写 Redis。
        # recorder / store 在异常时可能为 None，finally 里已做空值守卫。
        recorder: SessionTimingRecorder | None = None
        store: RedisTimingStore | None = None
        try:
            # 构建运行时所需的消息列表
            messages: dict[str, Any] = session.get_messages()
            messages.append(message.to_dict())

            recorder = SessionTimingRecorder(session.session_id, assistant_message_id)
            store = RedisTimingStore(get_settings())

            # 通过运行时执行
            async for event in self.runtime.run(
                messages=messages,
                config=self.config,
                session_id=session.session_id,
                user_id=session.user_id,
                user_mobile=session.user_mobile,
                channel=session.channel,
                channel_user_id=session.channel_user_id or session.user_id,
                # T03 S9 第 2 跳：MIS userId 全链透传（None 时下游 fail-closed）。
                mis_user_id=session.mis_user_id,
            ):
                recorder.observe(event)
                yield event
            # 注：成功路径不再在此 complete() 钉死 _end_t；计时窗交由 finally 末
            # 的 recorder.close() 收口到 post_process 完成之后（Q5 / T05）。
        except Exception:
            if recorder is not None:
                recorder.fail()
            raise
        finally:
            self.active_sessions -= 1
            # 计时降级：任何异常都静默吞掉，绝不阻断主对话链路。
            if recorder is not None and store is not None:
                try:
                    # post_process 三步打点（弱引用，异常静默）：
                    # db_persist / redis_write 步——本代码库消息落库由 API 路由在
                    # recorder 窗口外完成，此处仅保留打点接口（实测为空，记 null）；
                    # timing_save 步——store.save 在窗口内真实可测。
                    recorder.step_start("db_persist")
                    recorder.step_end("db_persist")
                    recorder.step_start("redis_write")
                    recorder.step_end("redis_write")
                    recorder.step_start("timing_save")
                    await store.save(
                        session.session_id,
                        assistant_message_id or recorder.turn_key,
                        recorder.snapshot(),
                    )
                    recorder.step_end("timing_save")
                except Exception as exc:  # noqa: BLE001
                    logger.warning(
                        "session timing save failed (degraded)",
                        session_id=session.session_id,
                        error=str(exc),
                    )
                finally:
                    # 窗口关闭：落定 _end_t（端到端 + post_process 终点）
                    recorder.close()

    async def health_check(self) -> HealthStatus:
        """检查此 Agent 实例的健康状态。"""
        runtime_health: HealthStatus = await self.runtime.health_check()
        return HealthStatus(
            healthy=runtime_health.healthy and self.lifecycle.is_active(),
            details={
                "agent_id": self.id,
                "state": self.lifecycle.current_state.value,
                "active_sessions": self.active_sessions,
                "runtime": runtime_health.details,
            },
        )

    async def shutdown(self) -> None:
        """关闭运行时并进行清理。"""
        await self.runtime.shutdown()
        self._initialized = False
        logger.info("Agent instance shut down", agent_id=self.id)


class AgentManager:
    """
    管理 Agent 实例的生命周期。

    职责：
    - 根据 AgentConfig 创建 Agent 实例
    - 管理生命周期状态（启动/暂停/恢复/停止/删除）
    - 提供实例访问以处理消息
    - 支持运行时切换
    - 支持配置热重载
    """

    def __init__(self) -> None:
        """初始化 Agent 管理器（空实例表）。"""
        self._instances: dict[str, AgentInstance] = {}
        self._runtime_registry = get_runtime_registry()
        self._llm_gateway: Any = None
        # T8/T9：多 Core 租约协调（注入前退化为「人人都起」旧行为，向后兼容单 Core）。
        self._core_id: str = ""
        self._core_ownership: Any = None
        self._redis: Any = None
        self._registry_task: Any = None

    def set_llm_gateway(self, gateway: Any) -> None:
        """注入 LLM Gateway 供运行时使用。"""
        self._llm_gateway = gateway

    # ------------------------------------------------------------------
    # 多 Core 租约 / 注册表绑定（T8 / 决策 1 + 同构问题②）
    # ------------------------------------------------------------------

    def bind_core(self, core_id: str, core_ownership: Any, redis: Any) -> None:
        """注入 Core 身份、租约协调器与 Redis 客户端（多 Core 模式）。

        未注入时 ``sync_from_configs`` 退化为「人人都起」旧行为（向后兼容单 Core）。

        Args:
            core_id: 本 Core 稳定 ID（``get_core_id()``）。
            core_ownership: ``CoreOwnership`` 实例（agent 运行时租约）。
            redis: 已连接的 ``redis.asyncio.Redis`` 实例（写注册表 / 读全局视图）。
        """
        self._core_id = core_id
        self._core_ownership = core_ownership
        self._redis = redis

    async def create_agent(self, config: AgentConfig) -> AgentInstance:
        """
        根据配置创建一个新的 Agent 实例。

        Args:
            config: 由 ConfigManager 加载的 AgentConfig。

        Returns:
            处于 CREATED 状态的 AgentInstance。

        Raises:
            若已存在相同 ID 的 agent，则抛出 AgentAlreadyExistsError。
        """
        if config.agent_id in self._instances:
            from src.utils.exceptions import AgentAlreadyExistsError

            raise AgentAlreadyExistsError(config.agent_id)

        # Create runtime via registry
        runtime_type: Any = config.runtime.type if config.runtime else None
        runtime: AgentRuntime = create_runtime(runtime_type, config)

        # Inject LLM gateway if available
        if self._llm_gateway is not None and hasattr(runtime, "set_llm_gateway"):
            runtime.set_llm_gateway(self._llm_gateway)

        instance: AgentInstance = AgentInstance(config=config, runtime=runtime)
        await instance.initialize()
        self._instances[config.agent_id] = instance

        logger.info("Agent created", agent_id=config.agent_id)
        return instance

    async def start_agent(self, agent_id: str) -> InstanceState:
        """启动一个 Agent 实例（CREATED/STOPPED → RUNNING）。"""
        instance: AgentInstance = self._get_instance(agent_id)
        instance.started_at = datetime.now(timezone.utc)
        state: InstanceState = instance.lifecycle.transition(LifecycleEvent.START)
        logger.info("Agent started", agent_id=agent_id, state=state.value)
        return state

    async def pause_agent(self, agent_id: str) -> InstanceState:
        """暂停一个 Agent 实例（RUNNING → PAUSED）。"""
        instance: AgentInstance = self._get_instance(agent_id)
        state: InstanceState = instance.lifecycle.transition(LifecycleEvent.PAUSE)
        logger.info("Agent paused", agent_id=agent_id)
        return state

    async def resume_agent(self, agent_id: str) -> InstanceState:
        """恢复一个已暂停的 Agent 实例（PAUSED → RUNNING）。"""
        instance: AgentInstance = self._get_instance(agent_id)
        state: InstanceState = instance.lifecycle.transition(LifecycleEvent.RESUME)
        logger.info("Agent resumed", agent_id=agent_id)
        return state

    async def stop_agent(self, agent_id: str) -> InstanceState:
        """停止一个 Agent 实例（转换到 STOPPED）。"""
        instance: AgentInstance = self._get_instance(agent_id)
        state: InstanceState = instance.lifecycle.transition(LifecycleEvent.STOP)
        logger.info("Agent stopped", agent_id=agent_id)
        return state

    async def delete_agent(self, agent_id: str) -> None:
        """永久删除一个 Agent 实例。"""
        instance: AgentInstance = self._get_instance(agent_id)
        await instance.shutdown()
        instance.lifecycle.transition(LifecycleEvent.DELETE)
        del self._instances[agent_id]
        logger.info("Agent deleted", agent_id=agent_id)

    def get_agent(self, agent_id: str) -> AgentInstance:
        """按 ID 获取一个 Agent 实例。"""
        return self._get_instance(agent_id)

    def has_instance(self, agent_id: str) -> bool:
        """判断指定 Agent 的运行实例是否存在。

        Args:
            agent_id: Agent ID。

        Returns:
            存在且未删除返回 ``True``。
        """
        return agent_id in self._instances

    async def reload_config(self, agent_id: str, config: AgentConfig) -> None:
        """用新配置热重载已运行的 Agent 实例（实例存在时）。

        仅对已存在的实例生效；新配置对新会话生效，旧会话沿用旧配置至完成。
        实例不存在时静默跳过（由 ``sync_from_configs`` 在下次启动时补齐）。

        Args:
            agent_id: Agent ID。
            config: 重新加载后的 AgentConfig。
        """
        if agent_id not in self._instances:
            logger.info("reload_config skipped (no running instance)", agent_id=agent_id)
            return
        await self.update_config(agent_id, config)
        logger.info("Agent config hot-reloaded", agent_id=agent_id)

    def list_agents(self) -> list[AgentInstance]:
        """列出所有 Agent 实例。"""
        return list(self._instances.values())

    async def update_config(self, agent_id: str, config: AgentConfig) -> None:
        """
        更新 Agent 的配置（热重载）。

        新配置对新会话生效。现有会话将继续使用旧配置直到完成。
        """
        instance: AgentInstance = self._get_instance(agent_id)
        old_config: Any = instance.config
        instance.config = config

        # Re-initialize runtime with new config for new sessions
        await instance.runtime.initialize(config)
        await wire_agent_runtime(instance.runtime, config)

        logger.info(
            "Agent config updated",
            agent_id=agent_id,
            old_version=old_config.version,
            new_version=config.version,
        )

    async def switch_runtime(self, agent_id: str, runtime_type: str) -> None:
        """
        将 Agent 切换到不同的运行时类型。

        旧运行时进入 DRAINING 状态，继续服务现有会话，
        新运行时处理新会话。
        """
        instance: AgentInstance = self._get_instance(agent_id)

        # Create new runtime
        new_runtime: AgentRuntime = create_runtime(runtime_type, instance.config)
        if self._llm_gateway is not None and hasattr(new_runtime, "set_llm_gateway"):
            new_runtime.set_llm_gateway(self._llm_gateway)
        await new_runtime.initialize(instance.config)
        await wire_agent_runtime(new_runtime, instance.config)

        # Drain old runtime
        old_runtime: Any = instance.runtime
        instance.lifecycle.transition(LifecycleEvent.DRAIN)

        # Switch to new runtime
        instance.runtime = new_runtime
        instance.lifecycle.transition(LifecycleEvent.START)

        # Shut down old runtime after draining
        await old_runtime.shutdown()

        logger.info(
            "Agent runtime switched",
            agent_id=agent_id,
            new_runtime=runtime_type,
        )

    async def sync_from_configs(self, configs: list[AgentConfig]) -> int:
        """根据 ConfigManager 的配置创建并启动 agent（幂等 + 多 Core 租约门控）。

        多 Core（T8 / 决策 1）：对每个 agent 先 ``claim`` 租约，仅当成为/保持 owner 时
        才在本地创建并启动运行时，并写入 ``aip:agent:registry`` 注册表；claim 失败
        （其他 core 已持有）则确保本进程没有该 agent 的运行时，避免双活。
        未注入 ``core_ownership``（单 Core）时退化为「人人都起」旧行为。

        Args:
            configs: Agent 配置列表。

        Returns:
            本核心成功同步（拥有并运行）的 agent 数量。
        """
        from src.utils.exceptions import AgentAlreadyExistsError

        synced: int = 0
        for config in configs:
            agent_id = config.agent_id

            # 多 Core 租约门控：仅本核心拥有的 agent 才起本地运行时。
            if self._core_ownership is not None:
                owned = await self._core_ownership.claim(agent_id)
                if not owned:
                    # 非本核心拥有：停掉本地可能残留的运行时（避免双活）。
                    if self.has_instance(agent_id):
                        await self._stop_local(agent_id)
                    continue

            try:
                await self.create_agent(config)
            except AgentAlreadyExistsError:
                instance: AgentInstance | None = self._instances.get(agent_id)
                if instance is not None:
                    await self.update_config(agent_id, config)
            except Exception as exc:
                logger.error(
                    "Failed to sync agent from config",
                    agent_id=agent_id,
                    error=str(exc),
                )
                continue

            synced_instance: AgentInstance | None = self._instances.get(agent_id)
            if synced_instance is not None:
                if not synced_instance.lifecycle.is_active():
                    await self.start_agent(agent_id)
                await self._write_registry(agent_id, synced_instance)
                synced += 1

        logger.info("Agents synced from configs", count=synced)
        return synced

    async def _stop_local(self, agent_id: str) -> None:
        """停止本进程内某 agent 的运行时（租约易主时调用，避免双活）。"""
        try:
            if self._instances.get(agent_id) is not None:
                await self.stop_agent(agent_id)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to stop local agent runtime on lease lost",
                agent_id=agent_id,
                error=str(exc),
            )

    # ------------------------------------------------------------------
    # Agent 注册表（aip:agent:registry hash，同构问题②）
    # ------------------------------------------------------------------

    async def _write_registry(self, agent_id: str, instance: AgentInstance) -> None:
        """写入/刷新本核心拥有的 agent 注册表条目。

        value = JSON{state, config_version, core_id, last_seen}。
        """
        if self._redis is None:
            return
        try:
            value = json.dumps(
                {
                    "state": instance.lifecycle.current_state.value,
                    "config_version": getattr(instance.config, "version", None),
                    "core_id": self._core_id,
                    "last_seen": datetime.now(timezone.utc).isoformat(),
                },
                ensure_ascii=False,
            )
            await self._redis.hset(agent_registry_key(), agent_id, value)
        except Exception as exc:  # noqa: BLE001 - 注册表写失败不应阻断启动
            logger.warning(
                "Failed to write agent registry entry",
                agent_id=agent_id,
                error=str(exc),
            )

    async def heartbeat_registry(self) -> None:
        """心跳刷新本核心拥有的全部 agent 注册表条目（last_seen / state）。"""
        if self._redis is None:
            return
        for instance in self._instances.values():
            if instance.lifecycle.is_active():
                await self._write_registry(instance.id, instance)

    def start_registry_heartbeat(self, interval_s: int = 10) -> None:
        """启动注册表心跳后台任务（周期刷新 ``aip:agent:registry``）。"""
        if self._registry_task is not None:
            logger.warning("Agent registry heartbeat already running")
            return
        self._registry_task = asyncio.create_task(
            self._registry_heartbeat_loop(max(1, interval_s))
        )
        logger.info("Agent registry heartbeat started", core_id=self._core_id)

    def stop_registry_heartbeat(self) -> None:
        """停止注册表心跳后台任务。"""
        if self._registry_task is not None:
            self._registry_task.cancel()
            self._registry_task = None
        logger.info("Agent registry heartbeat stopped", core_id=self._core_id)

    async def _registry_heartbeat_loop(self, interval_s: int) -> None:
        """注册表心跳单轮。"""
        while True:
            await asyncio.sleep(interval_s)
            try:
                await self.heartbeat_registry()
            except Exception as exc:  # noqa: BLE001 - 心跳失败不影响主流程
                logger.warning("Agent registry heartbeat pass failed", error=str(exc))

    async def list_registry_agents(self) -> list[dict[str, Any]]:
        """读取全局 Agent 注册表（跨 Core 视图，供观测 / 管理 API）。"""
        if self._redis is None:
            return []
        try:
            raw: dict[str, str] = await self._redis.hgetall(agent_registry_key())
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to read agent registry", error=str(exc))
            return []
        result: list[dict[str, Any]] = []
        for agent_id, value in raw.items():
            try:
                entry: dict[str, Any] = json.loads(value)
                entry["agent_id"] = agent_id
                result.append(entry)
            except (ValueError, TypeError):
                continue
        return result

    async def stop_agent_if_owned(self, agent_id: str) -> None:
        """租约易主时停掉本进程内该 agent 的运行时（避免双活）。

        Args:
            agent_id: 失主的 agent ID。
        """
        if self._core_ownership is not None:
            owner = await self._core_ownership.current_owner(agent_id)
            if owner != self._core_id:
                await self._stop_local(agent_id)

    async def release_all_leases(self) -> None:
        """释放本核心持有的全部 agent 租约（优雅关闭时调用）。"""
        if self._core_ownership is not None:
            for agent_id in list(self._instances.keys()):
                await self._core_ownership.release(agent_id)

    async def ensure_agent_ready(self, agent_id: str) -> AgentInstance:
        """
        确保 Agent 实例存在且处于 RUNNING 状态。

        若启动时未同步成功，在首次发消息时从 ConfigManager 懒加载并启动。
        """
        instance: AgentInstance | None = self._instances.get(agent_id)
        if instance is not None:
            if not instance.lifecycle.is_active():
                await self.start_agent(agent_id)
            return instance

        if self._llm_gateway is None:
            from src.llm.gateway import get_llm_gateway

            self.set_llm_gateway(get_llm_gateway())

        from src.config_manager.manager import get_config_manager

        config: AgentConfig = await get_config_manager().get_config(agent_id)
        await self.create_agent(config)
        await self.start_agent(agent_id)
        logger.info("Agent lazy-provisioned on demand", agent_id=agent_id)
        return self._instances[agent_id]

    async def get_agent_health(self, agent_id: str) -> HealthStatus:
        """检查指定 Agent 的健康状态。"""
        instance: AgentInstance = self._get_instance(agent_id)
        return await instance.health_check()

    async def shutdown_all(self) -> None:
        """关闭所有 Agent 实例（优雅关闭）。"""
        for agent_id, instance in list(self._instances.items()):
            try:
                await instance.shutdown()
                logger.info("Agent shut down during cleanup", agent_id=agent_id)
            except Exception as exc:
                logger.error("Error shutting down agent", agent_id=agent_id, error=str(exc))
        self._instances.clear()

    def _get_instance(self, agent_id: str) -> AgentInstance:
        """获取实例，若不存在则抛出 AgentNotFoundError。"""
        instance: AgentInstance | None = self._instances.get(agent_id)
        if instance is None:
            raise AgentNotFoundError(agent_id)
        return instance


# Singleton instance
_agent_manager: AgentManager | None = None


def get_agent_manager() -> AgentManager:
    """返回单例 AgentManager 实例。"""
    global _agent_manager
    if _agent_manager is None:
        _agent_manager = AgentManager()
    return _agent_manager
