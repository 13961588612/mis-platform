"""问数 MCP 连接失效看门狗 —— dry_run 连续报基础设施错误时自动重启 wren 进程。

## 为什么需要它

2026-10-02 真机故障：StarRocks 侧一次断连后，wren 进程**连接池里的连接失效且不自愈**。
故障画像极具迷惑性：

- wren 进程活着（`returncode is None`）——现有 health loop 探不到；
- MCP 协议正常：`list_models` / `list_cubes` / `get_context` / `dry_plan` 全部亚秒成功；
- 只有真正碰数据库的 `dry_run` 100% 失败，且 **0.13s 瞬回**
  `(2006, 'Server has gone away') phase=SQL_DRY_RUN`；
- 业务库本身完全正常（直连 `SELECT 1` 0.03s，空闲 65s 复用也 OK，`wait_timeout=28800`）。

结论：这是「连接池持有坏连接且不做失效检测」，重启该连接的 wren 进程是唯一恢复手段
（实测重启即恢复）。进程存活探测与 HTTP probe 都覆盖不到，必须用**应用层信号**：
连续若干次 `dry_run` 报基础设施错误。

## 设计要点

- **按连接计数**：不同连接的故障互不影响。
- **成功即清零**：一次 `dry_run` 成功就把该连接计数清零，避免累积误判。
- **冷却窗口**：两次自动重启之间至少间隔 `cooldown`，防重启风暴；冷却期内只计数不重启。
- **失败不外抛**：看门狗自身的任何异常都吞掉并记日志，绝不拖垮问数主链路。
- **可关闭**：`threshold <= 0` 时整体停用。

看门狗只负责**触发**重启，重启本身委托给可注入的 ``restart`` 回调
（生产为 ``WrenMcpLifecycleService.restart_connection``），便于测试时替换。
"""

from __future__ import annotations

from typing import Awaitable, Callable

from src.agent.mis_iqd.sql_errors import INFRA_ERROR_RE, sql_error_text
from src.utils.logging import get_logger

logger = get_logger("agent.mis_iqd.mcp_watchdog")

#: 重启回调签名：``(connection_id) -> Awaitable[Any]``。
RestartFn = Callable[[int | str], Awaitable[object]]


class McpConnectionWatchdog:
    """按连接统计 ``dry_run`` 基础设施错误，达阈值触发一次重启。

    Args:
        threshold: 连续基础设施错误达此值即触发重启；``<= 0`` 关闭看门狗。
        cooldown_seconds: 两次重启的最小间隔（秒）。
        restart: 重启回调（异步）；``None`` 时禁用实际重启（只记日志）。
    """

    def __init__(
        self,
        *,
        threshold: int,
        cooldown_seconds: float,
        restart: RestartFn | None = None,
    ) -> None:
        self._threshold: int = int(threshold)
        self._cooldown: float = max(0.0, float(cooldown_seconds))
        self._restart: RestartFn | None = restart
        #: conn_id → 连续基础设施错误次数
        self._failures: dict[str, int] = {}
        #: conn_id → 上次自动重启的单调时间
        self._last_restart: dict[str, float] = {}

    @property
    def enabled(self) -> bool:
        """阈值 > 0 且具备重启手段时才启用。"""
        return self._threshold > 0

    def _key(self, connection_id: int | str) -> str:
        return str(connection_id)

    def record_success(self, connection_id: int | str) -> None:
        """一次 ``dry_run`` 成功 → 该连接计数清零。"""
        self._failures.pop(self._key(connection_id), None)

    async def record_failure(
        self, connection_id: int | str, exc: BaseException
    ) -> bool:
        """记录一次 ``dry_run`` 失败；返回是否**本轮触发了重启**。

        只有基础设施类错误才计数（SQL 语法/列错误不是连接问题，重启没有意义）。非
        infra 错误直接返回 ``False``，且**不清零**已有计数（同一连接可能先连接坏、
        用户又改了 SQL，计数保留更符合「连接仍然可疑」的语义）。
        """
        if not self.enabled:
            return False
        text = sql_error_text(exc)
        if not INFRA_ERROR_RE.search(text):
            return False

        import time

        key = self._key(connection_id)
        self._failures[key] = self._failures.get(key, 0) + 1
        count = self._failures[key]
        if count < self._threshold:
            logger.warning(
                "IQD MCP dry_run infra failure (below watchdog threshold)",
                connection_id=key,
                failures=count,
                threshold=self._threshold,
            )
            return False

        now = time.monotonic()
        last = self._last_restart.get(key)
        if last is not None and (now - last) < self._cooldown:
            logger.warning(
                "IQD MCP watchdog restart suppressed by cooldown",
                connection_id=key,
                failures=count,
                seconds_since_last_restart=round(now - last, 1),
                cooldown=self._cooldown,
            )
            return False

        if self._restart is None:
            logger.warning(
                "IQD MCP watchdog would restart but no restart callback configured",
                connection_id=key,
                failures=count,
            )
            return False

        logger.warning(
            "IQD MCP watchdog restarting connection (dry_run infra failures)",
            connection_id=key,
            failures=count,
        )
        try:
            await self._restart(connection_id)
        except Exception as exc:  # noqa: BLE001 - 看门狗绝不影响主链路
            logger.error(
                "IQD MCP watchdog restart failed",
                connection_id=key,
                error=str(exc),
            )
            return False
        # 重启后清空计数，等待下一次从零累积（避免重启后立刻再次触发）。
        self._failures.pop(key, None)
        self._last_restart[key] = now
        return True
