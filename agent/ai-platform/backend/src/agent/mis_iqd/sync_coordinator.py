"""SyncCoordinator — 每连接增强同步合并窗口（P1-2 幂等/可重试）。

闭合回路：BFF → ai-platform ``POST /iqd/enhance/sync`` → :meth:`trigger`
→ :class:`~src.agent.mis_iqd.service.IqdAskService.trigger_build_index`
（拉待下发物料 → context build → memory index → 回填 + 报作业）。

合并窗口语义（architecture §五 / 待明确事项 P1-2）：
- ``wait=false``（保存后自动触发）：接受即返回 ``{accepted, coalesced}``，
  不阻塞；窗口内多次保存合并为一次 build+index。
- ``wait=true``（立即同步/重试按钮）：阻塞至 build+index 完成，返回完整 ``SyncResult``。
"""

from __future__ import annotations

import asyncio
from typing import Any

from src.agent.mis_iqd.service import IqdAskService, SyncResult
from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.sync_coordinator")


class SyncCoordinator:
    """每连接合并窗口协调器（进程内单例语义，按 connection 维护 in-flight 任务）。"""

    def __init__(self, coalesce_window_sec: float | None = None) -> None:
        """初始化协调器。

        Args:
            coalesce_window_sec: 合并窗口秒数（缺省取 ``IQD_CONFIG_SYNC_COALESCE_WINDOW_SEC``）。
        """
        settings = get_settings()
        self._window: float = (
            coalesce_window_sec
            if coalesce_window_sec is not None
            else settings.iqd_config.sync_coalesce_window_sec
        )
        self._locks: dict[int, asyncio.Lock] = {}
        self._tasks: dict[int, asyncio.Task[SyncResult]] = {}

    def _lock(self, connection_id: int) -> asyncio.Lock:
        """取（或建）连接级锁，保证同一连接 build 串行。"""
        return self._locks.setdefault(connection_id, asyncio.Lock())

    async def _resolve_primary_connection_id(self) -> int | None:
        """解析主连接 id（**委托** :meth:`IqdConfigClient.resolve_primary_connection_id`）。

        ⚠️ 更正历史 docstring：原实现只取 ``get_connections()[0].id``（= 最小 id enabled），
        **无视 ``name='default'``**，多条 ``enabled=true`` 并存时会与 Java 侧漂移
        （设计 §14.5.1 C）。现**统一委托**客户端方法（消费 ``is_primary`` 单一真值源，
        与 Java ``findPrimaryConnection()`` 同源），不再本地复现选主规则。
        """
        from src.adapters.iqd_config_client import IqdConfigClient

        client = IqdConfigClient()
        try:
            return await client.resolve_primary_connection_id()
        finally:
            await client.aclose()

    async def trigger(
        self, connection_id: int | None, wait: bool, scope: str = "materials"
    ) -> SyncResult:
        """触发一次增强同步。

        Args:
            connection_id: 问数连接 id（``None`` 解析主连接）。
            wait: ``True``=立即执行并返回完整结果；``False``=合并窗口后异步执行，立即返回 accepted。
            scope: 构建范围 ``materials``（一期物料）/ ``model``（二期模型写回）。

        Returns:
            ``SyncResult``（wait=true 为完整结果；wait=false 为 accepted 占位，coalesced 标记是否合并）。
        """
        cid = connection_id or await self._resolve_primary_connection_id()
        if cid is None:
            return SyncResult(
                connection_id=None,
                coalesced=False,
                build_status="failed",
                build_error="no primary connection",
            )

        lock = self._lock(cid)
        async with lock:
            existing = self._tasks.get(cid)
            if existing is not None and not existing.done():
                # 已在合并窗口内：本次保存合并进在进行的 build，标记 coalesced 立即返回
                return SyncResult(connection_id=cid, coalesced=True, build_status="pending")
            if wait:
                # 立即同步/重试：阻塞至 build+index 完成
                return await self._run(cid, scope)
            # 自动触发：启动 debounce 窗口，窗口内累计触发合并为一次 build
            self._tasks[cid] = asyncio.create_task(self._debounced_run(cid, scope))
            return SyncResult(connection_id=cid, coalesced=False, build_status="pending")

    async def _debounced_run(self, connection_id: int, scope: str = "materials") -> SyncResult:
        """窗口等待后执行一次 build+index，完成后清理 in-flight 任务。"""
        try:
            await asyncio.sleep(self._window)
            return await self._run(connection_id, scope)
        except Exception as exc:  # noqa: BLE001 - 异常归一为 failed 结果
            logger.error("IQD debounced sync failed", connection_id=connection_id, error=str(exc))
            return SyncResult(
                connection_id=connection_id,
                coalesced=False,
                build_status="failed",
                build_error=str(exc),
            )
        finally:
            self._tasks.pop(connection_id, None)

    async def _run(self, connection_id: int, scope: str = "materials") -> SyncResult:
        """执行一次完整 build+index+回填。"""
        service = IqdAskService()
        return await service.trigger_build_index(connection_id, wait=True, scope=scope)
