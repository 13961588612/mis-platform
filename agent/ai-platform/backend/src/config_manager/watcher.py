"""ConfigWatcher — 监控配置变更以支持热重载。

在 FILE_SYSTEM 模式下，周期性扫描 Agent 目录下关键文件 mtime
（含 ``agent.yaml``、``runtime/prompts/*.md`` 等）。
在 DATABASE 模式下，每隔 N 秒轮询 agent_configs 表。
检测到变更后，通知 ConfigManager 触发 AgentManager 热重载，
并在日志中打印变更文件的最新内容摘要。
"""

from __future__ import annotations
from typing import Any

import asyncio
from pathlib import Path

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("config_manager.watcher")

#: 单条变更日志最大字符数（避免超大 prompt 刷爆日志）
_CHANGE_CONTENT_LOG_CHARS = 8000

#: 相对 ``agents/{agent_id}/`` 需监控的文件 / 目录通配（posix）
_WATCH_RELATIVE_GLOBS: tuple[str, ...] = (
    "agent.yaml",
    "metadata.yaml",
    "runtime/runtime.yaml",
    "runtime/prompts/*.md",
    "system/model.yaml",
    "memory/personality.md",
    "intent-router.yaml",
    "coordination.yaml",
    "skills/enabled-skills.yaml",
)


class ConfigWatcher:
    """
    监控配置变更并触发回调。

    文件系统模式使用 asyncio 任务进行周期性目录扫描。
    数据库模式轮询 agent_configs 表的 updated_at 变更。

    回调函数会接收到发生变更的配置的 agent_id。
    """

    def __init__(self) -> None:
        """初始化配置变更监控器（文件 mtime 或数据库轮询）。"""
        self._settings = get_settings()
        self._base_path: str = self._settings.CONFIG_BASE_PATH
        self._mode: str = self._settings.CONFIG_MODE
        self._poll_interval: int = self._settings.CONFIG_RELOAD_INTERVAL
        self._callbacks: list[Any] = []
        self._task: asyncio.Task[None] | None = None
        self._running: bool = False
        # key: ``{agent_id}/{rel_path}``（posix），value: mtime
        self._file_mtimes: dict[str, float] = {}
        self._db_versions: dict[str, str] = {}

    def on_change(self, callback: Any) -> None:
        """
        为配置变更注册回调。

        回调函数接收以下参数：
        - agent_id: str — 变更的 agent 的 ID
        - change_type: str — "created"、"updated" 或 "deleted"
        """
        self._callbacks.append(callback)

    async def start(self) -> None:
        """开始监控配置变更。"""
        if self._running:
            return

        self._running = True
        self._task = asyncio.create_task(self._watch_loop())
        logger.info(
            "ConfigWatcher started",
            mode=self._mode,
            poll_interval=self._poll_interval,
            watch_globs=list(_WATCH_RELATIVE_GLOBS),
        )

    async def stop(self) -> None:
        """停止监控配置变更。"""
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("ConfigWatcher stopped")

    async def _watch_loop(self) -> None:
        """主监控循环 —— 按配置的时间间隔轮询变更。"""
        # 初始快照
        await self._take_snapshot()

        while self._running:
            try:
                await asyncio.sleep(self._poll_interval)
                await self._check_for_changes()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("ConfigWatcher error", error=str(exc))
                await asyncio.sleep(self._poll_interval)

    async def _take_snapshot(self) -> None:
        """获取当前配置状态的初始快照。"""
        if self._mode == "database":
            await self._snapshot_db()
        else:
            self._file_mtimes = self._collect_file_mtimes()
            logger.info(
                "ConfigWatcher file snapshot ready",
                tracked_files=len(self._file_mtimes),
            )

    def _collect_file_mtimes(self) -> dict[str, float]:
        """扫描 agents 下需监控文件的 mtime。

        Returns:
            ``{agent_id/rel_path: mtime}``。
        """
        agents_dir = Path(self._base_path) / "agents"
        result: dict[str, float] = {}
        if not agents_dir.exists():
            return result

        for entry in agents_dir.iterdir():
            if not entry.is_dir():
                continue
            agent_id = entry.name
            # 无 agent.yaml 的目录不视为有效 Agent
            if not (entry / "agent.yaml").exists():
                continue
            for rel_glob in _WATCH_RELATIVE_GLOBS:
                for path in entry.glob(rel_glob):
                    if not path.is_file():
                        continue
                    try:
                        rel = path.relative_to(entry).as_posix()
                        key = f"{agent_id}/{rel}"
                        result[key] = path.stat().st_mtime
                    except OSError:
                        continue
        return result

    async def _snapshot_db(self) -> None:
        """快照数据库配置版本。"""
        from sqlalchemy import select

        from src.db.session import db_session_context
        from src.models.agent import AgentConfigModel

        self._db_versions.clear()
        try:
            async with db_session_context() as session:
                stmt: Any = select(AgentConfigModel.agent_id, AgentConfigModel.updated_at).where(
                    AgentConfigModel.is_deleted == False,  # noqa: E712
                )
                result: Any = await session.execute(stmt)
                for row in result:
                    self._db_versions[row[0]] = row[1].isoformat() if row[1] else ""
        except Exception as exc:
            logger.error("Failed to snapshot DB configs", error=str(exc))

    async def _check_for_changes(self) -> None:
        """检查自上次快照以来的配置变更。"""
        if self._mode == "database":
            await self._check_db_changes()
        else:
            self._check_file_changes()

    def _check_file_changes(self) -> None:
        """检查文件系统变更（含 prompts / runtime / model 等）。"""
        current = self._collect_file_mtimes()
        old = self._file_mtimes

        current_agents = {key.split("/", 1)[0] for key in current}
        old_agents = {key.split("/", 1)[0] for key in old}

        # agent 目录级删除
        for agent_id in sorted(old_agents - current_agents):
            self._notify_change(agent_id, "deleted")

        # 按 agent 聚合文件变更，避免同轮多次 reload
        created_agents: set[str] = set()
        updated_agents: set[str] = set()
        changed_files_by_agent: dict[str, list[tuple[str, str]]] = {}

        for key, mtime in current.items():
            agent_id, rel = key.split("/", 1)
            old_mtime = old.get(key)
            if old_mtime is None:
                if agent_id not in old_agents:
                    created_agents.add(agent_id)
                else:
                    updated_agents.add(agent_id)
                changed_files_by_agent.setdefault(agent_id, []).append((rel, "created"))
            elif mtime > old_mtime:
                updated_agents.add(agent_id)
                changed_files_by_agent.setdefault(agent_id, []).append((rel, "updated"))

        for key in old:
            if key in current:
                continue
            agent_id, rel = key.split("/", 1)
            if agent_id not in current_agents:
                continue  # 整个 agent 已按 deleted 处理
            updated_agents.add(agent_id)
            changed_files_by_agent.setdefault(agent_id, []).append((rel, "deleted"))

        for agent_id in sorted(created_agents):
            self._log_changed_files(agent_id, changed_files_by_agent.get(agent_id, []))
            self._notify_change(agent_id, "created")

        for agent_id in sorted(updated_agents - created_agents):
            self._log_changed_files(agent_id, changed_files_by_agent.get(agent_id, []))
            self._notify_change(agent_id, "updated")

        self._file_mtimes = current

    def _log_changed_files(
        self,
        agent_id: str,
        changes: list[tuple[str, str]],
    ) -> None:
        """打印本轮变更文件路径与最新正文（删除仅记路径）。"""
        agents_dir = Path(self._base_path) / "agents" / agent_id
        for rel, file_change in changes:
            if file_change == "deleted":
                logger.info(
                    "Agent config file removed",
                    agent_id=agent_id,
                    path=rel,
                    change_type=file_change,
                )
                continue
            path = agents_dir / rel
            content = ""
            truncated = False
            try:
                raw = path.read_text(encoding="utf-8")
                if len(raw) > _CHANGE_CONTENT_LOG_CHARS:
                    content = raw[:_CHANGE_CONTENT_LOG_CHARS]
                    truncated = True
                else:
                    content = raw
            except OSError as exc:
                logger.warning(
                    "Failed to read changed config file",
                    agent_id=agent_id,
                    path=rel,
                    error=str(exc),
                )
                continue
            logger.info(
                "Agent config file changed — latest content",
                agent_id=agent_id,
                path=rel,
                change_type=file_change,
                content_chars=len(raw),
                content_truncated=truncated,
                content=content,
            )

    async def _check_db_changes(self) -> None:
        """检查数据库配置变更。"""
        from sqlalchemy import select

        from src.db.session import db_session_context
        from src.models.agent import AgentConfigModel

        current_versions: dict[str, str] = {}
        try:
            async with db_session_context() as session:
                stmt: Any = select(
                    AgentConfigModel.agent_id,
                    AgentConfigModel.updated_at,
                    AgentConfigModel.is_deleted,
                )
                result: Any = await session.execute(stmt)
                for row in result:
                    agent_id: Any = row[0]
                    version: str = row[1].isoformat() if row[1] else ""
                    is_deleted: Any = row[2]
                    if is_deleted:
                        current_versions[agent_id] = "deleted"
                    else:
                        current_versions[agent_id] = version
        except Exception as exc:
            logger.error("Failed to check DB config changes", error=str(exc))
            return

        # 与之前的快照进行比较
        for agent_id, version in current_versions.items():
            old_version: str | None = self._db_versions.get(agent_id)
            if old_version is None:
                if version != "deleted":
                    self._notify_change(agent_id, "created")
            elif version == "deleted" and old_version != "deleted":
                self._notify_change(agent_id, "deleted")
            elif version != old_version and version != "deleted":
                self._notify_change(agent_id, "updated")

        self._db_versions = current_versions

    def _notify_change(self, agent_id: str, change_type: str) -> None:
        """通知所有已注册的回调函数发生了配置变更。"""
        logger.info(
            "Config change detected",
            agent_id=agent_id,
            change_type=change_type,
        )
        for callback in self._callbacks:
            try:
                result: Any = callback(agent_id, change_type)
                # 同时支持同步和异步回调
                if asyncio.iscoroutine(result):
                    asyncio.create_task(result)
            except Exception as exc:
                logger.error(
                    "Config change callback failed",
                    agent_id=agent_id,
                    error=str(exc),
                )


# 单例实例
_config_watcher: ConfigWatcher | None = None


def get_config_watcher() -> ConfigWatcher:
    """返回单例 ConfigWatcher 实例。"""
    global _config_watcher
    if _config_watcher is None:
        _config_watcher = ConfigWatcher()
    return _config_watcher
