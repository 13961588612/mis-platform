"""企微多 Bot 配置持久化（impl-plan §11 Q4 **方案 A**：落 ai-platform 配置文件）。

存储位置：``{CONFIG_BASE_PATH}/{WECOM_BOT_CONFIG_FILE}``，默认
``/app/configs/channels/wecom-bots.yaml``。

.. code-block:: yaml

    version: 1
    bots:
      - bot_id: wb-3f2a1c9d
        name: 运维助手
        enabled: true
        ws_url: wss://qyapi.weixin.qq.com/ws/xxx
        secret: <明文>
        bound_agent_id: ops-agent
        created_at: "2025-01-01T12:00:00+00:00"
        updated_at: "2025-01-01T12:00:00+00:00"

设计要点
--------

* **不新造存储**（team-lead 硬约束）：复用 ``CONFIG_BASE_PATH`` 下的 YAML 文件，
  与 #22–#24 的 ``config_manager.file_service`` 同一套「原子写 + 落盘后触发
  reload 回调」机制。
* **为什么不直接调 ConfigManager**：:class:`~src.config_manager.manager.ConfigManager`
  与 :class:`~src.config_manager.watcher.ConfigWatcher` 都是 **agent 维度**的
  （key 是 ``agent_id``，扫描 ``configs/agents/*``），而 ``channels/wecom-bots.yaml``
  是**跨 Agent 的全局文件**，塞进 agent 维度缓存会污染 ``list_agent_ids()``
  并让 ``refresh_worker_catalog()`` 拿到一个假 Agent。因此本 Store 自带同构的
  三件套（mtime 感知重载 / 原子写 / ``on_change`` 回调），语义与 ConfigManager
  一致但作用域独立。这是对 §10.3 约定 11 的**有意偏离**，已在交付说明中标注。
* **secret 只写不读**：响应侧一律走 :meth:`WecomBotRecord.to_wire`（输出
  ``secret_masked``）；更新时 ``secret`` 缺省 = 沿用旧值，与前端
  ``agent-wecom-bot-dialog.tsx`` 的「不勾选『更换 Secret』就不发送」严格对称。
* **写路径永不半写**：先写 ``.tmp`` 再 ``os.replace`` 原子替换，避免 Gateway
  正好在启动拉取时读到截断文件。
* **健康状态来自 Gateway**：backend 不持有 WS 连接，无法自知 Bot 是否在线。
  #54 转发 Gateway ``/admin/bots/health``；Gateway 不可达时整体降级为
  ``unknown``（disabled 的 Bot 直接判 ``disconnected``，无需询问 Gateway）。
"""

from __future__ import annotations

import asyncio
import os
import uuid
from pathlib import Path
from typing import Any, Callable

import yaml

from src.channels.models import (
    BOT_HEALTH_VALUES,
    WecomBotCreateRequest,
    WecomBotRecord,
    WecomBotUpdateRequest,
    _utc_now_iso,
)
from src.config import Settings, get_settings
from src.utils.exceptions import AIPlatformError
from src.utils.logging import get_logger

logger = get_logger("channels.wecom_bot_store")

#: YAML 顶层 schema 版本，未来结构演进时用于兼容分支。
SCHEMA_VERSION: int = 1

#: 单文件最多允许的 Bot 数量（防止误操作把文件撑爆）。
MAX_BOTS: int = 200

#: 向 Gateway 查询健康状态的超时（秒）。宁可快速降级也不拖慢运营台列表。
GATEWAY_HEALTH_TIMEOUT_SECONDS: float = 2.0


class WecomBotNotFoundError(AIPlatformError):
    """请求的企微 Bot 不存在时抛出（错误码复用渠道域 5001）。"""

    def __init__(self, bot_id: str) -> None:
        """根据 Bot ID 构造异常消息。

        Args:
            bot_id: 未找到的 Bot ID。
        """
        super().__init__(f"WeCom bot not found: {bot_id}", code=5001)
        self.bot_id: str = bot_id


class WecomBotConflictError(AIPlatformError):
    """Bot 数量超限或名称冲突等业务冲突时抛出。"""

    def __init__(self, message: str) -> None:
        """设置错误码 5002 与冲突消息。

        Args:
            message: 冲突描述。
        """
        super().__init__(message, code=5002)


def _generate_bot_id() -> str:
    """生成一个短且可读的 Bot ID。

    Returns:
        形如 ``wb-3f2a1c9d`` 的 ID（``wb-`` 前缀 + 8 位十六进制）。
    """
    return f"wb-{uuid.uuid4().hex[:8]}"


class WecomBotStore:
    """``configs/channels/wecom-bots.yaml`` 的读写门面。

    线程/协程安全：所有变更方法串行化在 :attr:`_lock` 上；读方法基于
    mtime 做惰性重载，读到的是不可变快照（返回 copy，调用方改不脏内存）。
    """

    def __init__(self, path: Path | None = None) -> None:
        """初始化 Store 并做一次初始加载。

        Args:
            path: 显式指定 YAML 路径（测试用）。为 ``None`` 时从
                ``Settings.CONFIG_BASE_PATH`` + ``Settings.WECOM_BOT_CONFIG_FILE`` 推导。
        """
        self._explicit_path: Path | None = path
        self._bots: dict[str, WecomBotRecord] = {}
        self._order: list[str] = []
        self._mtime: float = -1.0
        self._lock: asyncio.Lock = asyncio.Lock()
        self._on_change_callbacks: list[Callable[[str, str], Any]] = []
        self._load(force=True)

    # -------------------------------------------------------------------
    # 路径与加载
    # -------------------------------------------------------------------

    @property
    def path(self) -> Path:
        """解析出的 YAML 绝对路径（每次读取 settings，便于测试覆写）。"""
        if self._explicit_path is not None:
            return self._explicit_path
        settings: Settings = get_settings()
        raw: Path = Path(settings.WECOM_BOT_CONFIG_FILE)
        if raw.is_absolute():
            return raw
        return Path(settings.CONFIG_BASE_PATH) / raw

    def _current_mtime(self) -> float:
        """返回配置文件的 mtime；文件不存在时返回 ``-1.0``。"""
        try:
            return self.path.stat().st_mtime
        except OSError:
            return -1.0

    def _load(self, force: bool = False) -> None:
        """按需从磁盘重新加载 Bot 列表（mtime 未变时跳过）。

        文件缺失 / 解析失败都**不抛异常**，只记日志并保持上一份内存快照，
        以免运营台列表因为一次手改笔误而整体 500。

        Args:
            force: 为 ``True`` 时忽略 mtime 缓存强制重载。
        """
        mtime: float = self._current_mtime()
        if not force and mtime == self._mtime:
            return

        path: Path = self.path
        if mtime < 0:
            # 文件尚未创建：视为空列表（首次 create 时自动建文件）。
            self._bots = {}
            self._order = []
            self._mtime = mtime
            return

        try:
            raw: Any = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError) as exc:
            logger.error(
                "Failed to load wecom bots config, keeping in-memory snapshot",
                path=str(path),
                error=str(exc),
            )
            return

        if not isinstance(raw, dict):
            logger.error("wecom bots config root is not a mapping", path=str(path))
            return

        items: Any = raw.get("bots") or []
        if not isinstance(items, list):
            logger.error("wecom bots config `bots` is not a list", path=str(path))
            return

        bots: dict[str, WecomBotRecord] = {}
        order: list[str] = []
        for item in items:
            if not isinstance(item, dict):
                logger.warning("Skip non-mapping wecom bot entry", path=str(path))
                continue
            try:
                record: WecomBotRecord = WecomBotRecord.model_validate(item)
            except Exception as exc:
                logger.warning("Skip invalid wecom bot entry", error=str(exc))
                continue
            if not record.bot_id:
                logger.warning("Skip wecom bot entry without bot_id")
                continue
            if record.bot_id in bots:
                logger.warning("Duplicate bot_id in config, last one wins", bot_id=record.bot_id)
                order.remove(record.bot_id)
            bots[record.bot_id] = record
            order.append(record.bot_id)

        self._bots = bots
        self._order = order
        self._mtime = mtime
        logger.info("WeCom bots config loaded", path=str(path), count=len(bots))

    def _persist(self) -> None:
        """把内存快照原子落盘（先写临时文件再 ``os.replace``）。

        Raises:
            AIPlatformError: 写盘失败时抛出（错误码 9000）。
        """
        path: Path = self.path
        payload: dict[str, Any] = {
            "version": SCHEMA_VERSION,
            "bots": [self._bots[bot_id].to_yaml_dict() for bot_id in self._order],
        }
        tmp_path: Path = path.with_name(f"{path.name}.tmp")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            text: str = yaml.safe_dump(
                payload,
                allow_unicode=True,
                default_flow_style=False,
                sort_keys=False,
            )
            tmp_path.write_text(text, encoding="utf-8")
            os.replace(tmp_path, path)
        except OSError as exc:
            # 清理半写的临时文件，保证下次写入不受污染。
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass
            logger.error("Failed to persist wecom bots config", path=str(path), error=str(exc))
            raise AIPlatformError(f"Failed to persist wecom bots config: {exc}", code=9000)

        self._mtime = self._current_mtime()
        logger.info("WeCom bots config persisted", path=str(path), count=len(self._order))

    # -------------------------------------------------------------------
    # 变更回调（与 ConfigManager.on_config_change 同构）
    # -------------------------------------------------------------------

    def on_change(self, callback: Callable[[str, str], Any]) -> None:
        """注册配置变更回调。

        Args:
            callback: 形如 ``callback(bot_id, change_type)`` 的可调用对象，
                ``change_type`` 取 ``created`` / ``updated`` / ``deleted``。
                同步或异步均可（异步会被 await）。
        """
        self._on_change_callbacks.append(callback)

    async def _notify(self, bot_id: str, change_type: str) -> None:
        """触发所有已注册回调；单个回调异常不影响其他回调与主链路。

        Args:
            bot_id: 发生变更的 Bot ID。
            change_type: ``created`` / ``updated`` / ``deleted``。
        """
        for callback in self._on_change_callbacks:
            try:
                result: Any = callback(bot_id, change_type)
                if hasattr(result, "__await__"):
                    await result
            except Exception as exc:
                logger.error(
                    "WeCom bot change callback failed",
                    bot_id=bot_id,
                    change_type=change_type,
                    error=str(exc),
                )

    # -------------------------------------------------------------------
    # 读
    # -------------------------------------------------------------------

    def list_records(self, enabled_only: bool = False) -> list[WecomBotRecord]:
        """列出全部 Bot 的落盘态记录（**含明文 secret**，仅内部使用）。

        Args:
            enabled_only: 为 ``True`` 时只返回 ``enabled=true`` 的记录。

        Returns:
            按文件内顺序排列的记录列表（副本）。
        """
        self._load()
        records: list[WecomBotRecord] = [self._bots[bot_id] for bot_id in self._order]
        if enabled_only:
            records = [r for r in records if r.enabled]
        return [r.model_copy(deep=True) for r in records]

    def get_record(self, bot_id: str) -> WecomBotRecord:
        """按 ID 获取单个 Bot 的落盘态记录。

        Args:
            bot_id: Bot ID。

        Returns:
            记录副本。

        Raises:
            WecomBotNotFoundError: Bot 不存在时抛出。
        """
        self._load()
        record: WecomBotRecord | None = self._bots.get(bot_id)
        if record is None:
            raise WecomBotNotFoundError(bot_id)
        return record.model_copy(deep=True)

    def exists(self, bot_id: str) -> bool:
        """判断 Bot 是否存在。

        Args:
            bot_id: Bot ID。

        Returns:
            存在返回 ``True``。
        """
        self._load()
        return bot_id in self._bots

    # -------------------------------------------------------------------
    # 写
    # -------------------------------------------------------------------

    async def create(self, payload: WecomBotCreateRequest) -> WecomBotRecord:
        """创建一个新 Bot（#49）。

        Args:
            payload: 创建请求体。

        Returns:
            新建的记录副本。

        Raises:
            WecomBotConflictError: Bot 数量超限或同名 Bot 已存在时抛出。
            AIPlatformError: 落盘失败时抛出。
        """
        async with self._lock:
            self._load()
            if len(self._bots) >= MAX_BOTS:
                raise WecomBotConflictError(f"Too many wecom bots (max={MAX_BOTS})")
            for existing in self._bots.values():
                if existing.name == payload.name:
                    raise WecomBotConflictError(f"WeCom bot name already exists: {payload.name}")

            bot_id: str = _generate_bot_id()
            while bot_id in self._bots:  # 极低概率碰撞，兜底重试
                bot_id = _generate_bot_id()

            now: str = _utc_now_iso()
            record: WecomBotRecord = WecomBotRecord(
                bot_id=bot_id,
                name=payload.name,
                enabled=True,
                ws_url=payload.ws_url,
                secret=payload.secret,
                bound_agent_id=payload.bound_agent_id,
                created_at=now,
                updated_at=now,
            )
            self._bots[bot_id] = record
            self._order.append(bot_id)
            self._persist()

        await self._notify(bot_id, "created")
        return record.model_copy(deep=True)

    async def update(self, bot_id: str, payload: WecomBotUpdateRequest) -> WecomBotRecord:
        """更新一个已存在的 Bot（#50）。

        ``secret`` 缺省或为空串 ⇒ **沿用旧值**；需要清空必须显式
        ``secret_clear=true``。这与前端「不勾选『更换 Secret』就不发送」对称。

        Args:
            bot_id: 目标 Bot ID。
            payload: 更新请求体。

        Returns:
            更新后的记录副本。

        Raises:
            WecomBotNotFoundError: Bot 不存在时抛出。
            WecomBotConflictError: 改名后与其他 Bot 重名时抛出。
            AIPlatformError: 落盘失败时抛出。
        """
        async with self._lock:
            self._load()
            record: WecomBotRecord | None = self._bots.get(bot_id)
            if record is None:
                raise WecomBotNotFoundError(bot_id)

            if payload.name is not None and payload.name != "":
                for other_id, other in self._bots.items():
                    if other_id != bot_id and other.name == payload.name:
                        raise WecomBotConflictError(
                            f"WeCom bot name already exists: {payload.name}"
                        )
                record.name = payload.name

            if payload.ws_url is not None and payload.ws_url != "":
                record.ws_url = payload.ws_url

            if payload.secret_clear:
                record.secret = ""
            elif payload.secret:
                record.secret = payload.secret

            if payload.bound_agent_id is not None:
                # 显式传空串 = 解绑（前端 `bound_agent_id || undefined` 不会传空串，
                # 但 API 层保留该语义供其他调用方使用）。
                record.bound_agent_id = payload.bound_agent_id

            record.updated_at = _utc_now_iso()
            self._bots[bot_id] = record
            self._persist()

        await self._notify(bot_id, "updated")
        return record.model_copy(deep=True)

    async def set_enabled(self, bot_id: str, enabled: bool) -> WecomBotRecord:
        """启用 / 停用一个 Bot（#52 / #53）。幂等。

        Args:
            bot_id: 目标 Bot ID。
            enabled: 目标状态。

        Returns:
            更新后的记录副本。

        Raises:
            WecomBotNotFoundError: Bot 不存在时抛出。
            AIPlatformError: 落盘失败时抛出。
        """
        async with self._lock:
            self._load()
            record: WecomBotRecord | None = self._bots.get(bot_id)
            if record is None:
                raise WecomBotNotFoundError(bot_id)

            if record.enabled == enabled:
                # 幂等：状态未变则不写盘、不触发回调，避免无谓的 Gateway 抖动。
                return record.model_copy(deep=True)

            record.enabled = enabled
            record.updated_at = _utc_now_iso()
            self._bots[bot_id] = record
            self._persist()

        await self._notify(bot_id, "updated")
        return record.model_copy(deep=True)

    async def delete(self, bot_id: str) -> bool:
        """删除一个 Bot（#51）。幂等：不存在时返回 ``False`` 而非报错。

        Args:
            bot_id: 目标 Bot ID。

        Returns:
            实际删除了返回 ``True``；本就不存在返回 ``False``。

        Raises:
            AIPlatformError: 落盘失败时抛出。
        """
        async with self._lock:
            self._load()
            if bot_id not in self._bots:
                return False
            self._bots.pop(bot_id, None)
            if bot_id in self._order:
                self._order.remove(bot_id)
            self._persist()

        await self._notify(bot_id, "deleted")
        return True

    # -------------------------------------------------------------------
    # 健康状态
    # -------------------------------------------------------------------

    async def fetch_health_map(self) -> dict[str, str]:
        """汇总所有 Bot 的健康状态（#54）。

        ``enabled=false`` 的 Bot 直接判 ``disconnected``（Gateway 本就不会为它
        建实例）；``enabled=true`` 的向 Gateway ``/admin/bots/health`` 查询，
        Gateway 不可达 / 超时 / 返回异常时统一降级为 ``unknown``。

        Returns:
            ``{bot_id: 'connected'|'disconnected'|'unknown'}``，与前端
            ``getWecomBotsHealth(): Record<string, WecomBot['health']>`` 对齐。
        """
        self._load()
        result: dict[str, str] = {}
        enabled_ids: list[str] = []
        for bot_id in self._order:
            record: WecomBotRecord = self._bots[bot_id]
            if record.enabled:
                result[bot_id] = "unknown"
                enabled_ids.append(bot_id)
            else:
                result[bot_id] = "disconnected"

        if not enabled_ids:
            return result

        gateway_health: dict[str, str] = await self._query_gateway_health()
        for bot_id in enabled_ids:
            value: str | None = gateway_health.get(bot_id)
            if value in BOT_HEALTH_VALUES:
                result[bot_id] = value
        return result

    async def _query_gateway_health(self) -> dict[str, str]:
        """向 Gateway ``/admin/bots/health`` 查询运行时健康状态。

        Returns:
            ``{bot_id: health}``；任何失败都返回空字典（调用方降级为 ``unknown``）。
        """
        settings: Settings = get_settings()
        base_url: str = (settings.GATEWAY_API_URL or "").rstrip("/")
        if not base_url:
            return {}

        url: str = f"{base_url}/admin/bots/health"
        try:
            import httpx

            async with httpx.AsyncClient(timeout=GATEWAY_HEALTH_TIMEOUT_SECONDS) as client:
                response: Any = await client.get(url)
                if response.status_code != 200:
                    logger.warning(
                        "Gateway health endpoint returned non-200",
                        url=url,
                        status=response.status_code,
                    )
                    return {}
                body: Any = response.json()
        except Exception as exc:
            # Gateway 未起 / 网络不通都属于预期内场景，只记 WARNING 不打断列表。
            logger.warning("Gateway health query failed, degrading to unknown", url=url, error=str(exc))
            return {}

        # 兼容两种回包：裸 map，或统一信封 {code,data,...}。
        payload: Any = body
        if isinstance(body, dict) and "data" in body and isinstance(body.get("data"), (dict, list)):
            payload = body["data"]

        health: dict[str, str] = {}
        if isinstance(payload, dict):
            for key, value in payload.items():
                if isinstance(value, str):
                    health[str(key)] = value
                elif isinstance(value, dict):
                    # 形如 {botId: {status: 'connected'}}
                    status_value: Any = value.get("health") or value.get("status")
                    if isinstance(status_value, str):
                        health[str(key)] = status_value
        elif isinstance(payload, list):
            for item in payload:
                if not isinstance(item, dict):
                    continue
                key: Any = item.get("bot_id") or item.get("botId")
                status_value: Any = item.get("health") or item.get("status")
                if isinstance(key, str) and isinstance(status_value, str):
                    health[key] = status_value
        return health

    # -------------------------------------------------------------------
    # wire 输出
    # -------------------------------------------------------------------

    async def list_wire(self, enabled_only: bool = False) -> list[dict[str, Any]]:
        """列出前端契约形态的 Bot 列表（#48）。

        Args:
            enabled_only: 为 ``True`` 时只返回启用中的 Bot（Gateway 启动拉取用）。

        Returns:
            ``WecomBot[]``，secret 已脱敏，``health`` 已填充。
        """
        records: list[WecomBotRecord] = self.list_records(enabled_only=enabled_only)
        health_map: dict[str, str] = await self.fetch_health_map()
        return [r.to_wire(health=health_map.get(r.bot_id, "unknown")) for r in records]

    async def get_wire(self, bot_id: str) -> dict[str, Any]:
        """获取单个 Bot 的前端契约形态。

        Args:
            bot_id: Bot ID。

        Returns:
            单个 ``WecomBot`` 字典。

        Raises:
            WecomBotNotFoundError: Bot 不存在时抛出。
        """
        record: WecomBotRecord = self.get_record(bot_id)
        if not record.enabled:
            return record.to_wire(health="disconnected")
        health_map: dict[str, str] = await self.fetch_health_map()
        return record.to_wire(health=health_map.get(bot_id, "unknown"))


# ===========================================================================
# 单例
# ===========================================================================

_wecom_bot_store: WecomBotStore | None = None


def get_wecom_bot_store() -> WecomBotStore:
    """返回单例 :class:`WecomBotStore` 实例。"""
    global _wecom_bot_store
    if _wecom_bot_store is None:
        _wecom_bot_store = WecomBotStore()
    return _wecom_bot_store


def reset_wecom_bot_store() -> None:
    """清空单例（仅供测试在切换 ``CONFIG_BASE_PATH`` 后重建 Store）。"""
    global _wecom_bot_store
    _wecom_bot_store = None
