"""QuotaManager — token 配额控制、速率限制和告警。

在 Redis 中按用户和部门追踪每日 token 用量。
限额来源（优先级从高到低）：

1. 环境变量 / ``Settings``（``LLM_QUOTA_PER_USER`` 等，非空才覆盖）
2. ``configs/system/system.yaml`` → ``llm_gateway.cost_control``
3. 内置默认（与 yaml 文档一致：用户 10 万 / 部门 100 万 / 告警 80%）

当配额超限时：``hard_limit=true`` 抛 ``QuotaExceededError``；否则仅告警放行。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import redis.asyncio as aioredis
import yaml

from src.config import Settings, get_settings
from src.llm.models import QuotaInfo
from src.utils.exceptions import QuotaExceededError
from src.utils.logging import get_logger
from src.utils.redis_reconnect import aclose_redis_quietly, is_broken_redis_connection

logger = get_logger("llm.quota_manager")

# Redis key 前缀
USER_QUOTA_PREFIX = "quota:user"
DEPT_QUOTA_PREFIX = "quota:dept"
# 当前日期后缀的 Redis key（每日重置）
DATE_FORMAT = "%Y%m%d"

# 与 system.yaml cost_control 对齐的内置兜底
_FALLBACK_USER_LIMIT = 100_000
_FALLBACK_DEPT_LIMIT = 1_000_000
_FALLBACK_ALERT_THRESHOLD = 0.8
_FALLBACK_HARD_LIMIT = True


@dataclass(frozen=True)
class QuotaLimits:
    """解析后的配额限额。"""

    per_user: int
    per_department: int
    alert_threshold: float
    hard_limit: bool
    source: str


def _candidate_system_yaml_paths(settings: Settings) -> list[Path]:
    """按优先级列出 system.yaml 候选路径。"""
    paths: list[Path] = []
    base = Path(settings.CONFIG_BASE_PATH)
    paths.append(base / "system" / "system.yaml")
    # 本地开发：backend/src/llm → ai-platform/configs
    repo_configs = Path(__file__).resolve().parents[3] / "configs" / "system" / "system.yaml"
    paths.append(repo_configs)
    return paths


def load_cost_control_from_system_yaml(settings: Settings | None = None) -> dict[str, Any]:
    """读取 ``system.yaml`` 中 ``llm_gateway.cost_control``（文件缺失则空 dict）。"""
    cfg = settings or get_settings()
    for path in _candidate_system_yaml_paths(cfg):
        if not path.is_file():
            continue
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to read system.yaml for cost_control",
                path=str(path),
                error=str(exc),
            )
            continue
        if not isinstance(raw, dict):
            continue
        gateway = raw.get("llm_gateway")
        if not isinstance(gateway, dict):
            continue
        cost = gateway.get("cost_control")
        if isinstance(cost, dict):
            logger.info("Loaded LLM cost_control from system.yaml", path=str(path))
            return cost
    return {}


def resolve_quota_limits(settings: Settings | None = None) -> QuotaLimits:
    """合并 yaml + Settings，得到最终配额。"""
    cfg = settings or get_settings()
    cost = load_cost_control_from_system_yaml(cfg)
    default_quota = cost.get("default_quota") if isinstance(cost.get("default_quota"), dict) else {}

    yaml_user = default_quota.get("per_user")
    yaml_dept = default_quota.get("per_department")
    yaml_alert = cost.get("alert_threshold")
    yaml_hard = cost.get("hard_limit")

    sources: list[str] = []

    def pick_int(env_val: int | None, yaml_val: Any, fallback: int, label: str) -> int:
        if env_val is not None:
            sources.append(f"{label}=env")
            return int(env_val)
        if isinstance(yaml_val, (int, float)) and int(yaml_val) > 0:
            sources.append(f"{label}=yaml")
            return int(yaml_val)
        sources.append(f"{label}=fallback")
        return fallback

    def pick_float(env_val: float | None, yaml_val: Any, fallback: float, label: str) -> float:
        if env_val is not None:
            sources.append(f"{label}=env")
            return float(env_val)
        if isinstance(yaml_val, (int, float)):
            sources.append(f"{label}=yaml")
            return float(yaml_val)
        sources.append(f"{label}=fallback")
        return fallback

    def pick_bool(env_val: bool | None, yaml_val: Any, fallback: bool, label: str) -> bool:
        if env_val is not None:
            sources.append(f"{label}=env")
            return bool(env_val)
        if isinstance(yaml_val, bool):
            sources.append(f"{label}=yaml")
            return yaml_val
        sources.append(f"{label}=fallback")
        return fallback

    limits = QuotaLimits(
        per_user=pick_int(cfg.LLM_QUOTA_PER_USER, yaml_user, _FALLBACK_USER_LIMIT, "per_user"),
        per_department=pick_int(
            cfg.LLM_QUOTA_PER_DEPARTMENT, yaml_dept, _FALLBACK_DEPT_LIMIT, "per_department"
        ),
        alert_threshold=pick_float(
            cfg.LLM_QUOTA_ALERT_THRESHOLD,
            yaml_alert,
            _FALLBACK_ALERT_THRESHOLD,
            "alert_threshold",
        ),
        hard_limit=pick_bool(
            cfg.LLM_QUOTA_HARD_LIMIT, yaml_hard, _FALLBACK_HARD_LIMIT, "hard_limit"
        ),
        source=",".join(sources),
    )
    return limits


class QuotaManager:
    """
    按用户和部门管理 token 配额。

    每次 LLM 调用前都会进行配额检查：
    1. 查询 Redis 获取今日已用 token 数（用户 + 部门）
    2. 对比每日限额进行预检查
    3. 调用完成后更新实际用量
    """

    def __init__(self, limits: QuotaLimits | None = None) -> None:
        """初始化 token 配额管理器（Redis 连接懒创建）。"""
        self._settings = get_settings()
        self._redis: aioredis.Redis | None = None
        resolved = limits or resolve_quota_limits(self._settings)
        self._default_user_limit = resolved.per_user
        self._default_dept_limit = resolved.per_department
        self._alert_threshold = resolved.alert_threshold
        self._hard_limit = resolved.hard_limit
        logger.info(
            "QuotaManager limits resolved",
            per_user=self._default_user_limit,
            per_department=self._default_dept_limit,
            alert_threshold=self._alert_threshold,
            hard_limit=self._hard_limit,
            source=resolved.source,
        )

    def reload_limits(self) -> QuotaLimits:
        """热重载限额（改 yaml / 环境后可不重启进程时调用）。"""
        resolved = resolve_quota_limits(get_settings())
        self._default_user_limit = resolved.per_user
        self._default_dept_limit = resolved.per_department
        self._alert_threshold = resolved.alert_threshold
        self._hard_limit = resolved.hard_limit
        logger.info(
            "QuotaManager limits reloaded",
            per_user=self._default_user_limit,
            per_department=self._default_dept_limit,
            source=resolved.source,
        )
        return resolved

    async def _get_redis(self) -> aioredis.Redis:
        """获取或创建 Redis 连接。"""
        if self._redis is None:
            self._redis = aioredis.from_url(
                self._settings.redis_url,
                max_connections=self._settings.REDIS_MAX_CONNECTIONS,
                decode_responses=True,
                health_check_interval=30,
                socket_keepalive=True,
                retry_on_timeout=True,
            )
        return self._redis

    async def _reset_redis(self) -> None:
        """丢弃可能已死的 Redis 客户端，下次 ``_get_redis`` 重建。"""
        client = self._redis
        self._redis = None
        await aclose_redis_quietly(client)

    async def _redis_op(self, op_name: str, *args: Any, **kwargs: Any) -> Any:
        """执行一次 Redis 命令；遇死连接则重建后重试一次。"""
        redis = await self._get_redis()
        try:
            return await getattr(redis, op_name)(*args, **kwargs)
        except Exception as exc:
            if not is_broken_redis_connection(exc):
                raise
            logger.warning(
                "QuotaManager Redis connection broken; reconnecting",
                op=op_name,
                error=str(exc),
            )
            await self._reset_redis()
            redis = await self._get_redis()
            return await getattr(redis, op_name)(*args, **kwargs)

    def _date_suffix(self) -> str:
        """获取 Redis key 的今日日期后缀（YYYYMMDD）。"""
        return datetime.now(timezone.utc).strftime(DATE_FORMAT)

    def _user_key(self, user_id: str) -> str:
        """用户每日配额的 Redis key（含命名空间前缀）。"""
        return f"{self._settings.REDIS_KEY_PREFIX}{USER_QUOTA_PREFIX}:{user_id}:{self._date_suffix()}"

    def _dept_key(self, dept: str) -> str:
        """部门每日配额的 Redis key（含命名空间前缀）。"""
        return f"{self._settings.REDIS_KEY_PREFIX}{DEPT_QUOTA_PREFIX}:{dept}:{self._date_suffix()}"

    async def check_quota(
        self,
        user_id: str,
        dept: str,
        estimated_tokens: int = 4096,
    ) -> bool:
        """
        检查用户/部门是否还有足够的剩余配额。

        Args:
            user_id: 用户标识符。
            dept: 部门标识符。
            estimated_tokens: 本次请求预估的 token 数。

        Returns:
            配额充足时返回 True；``hard_limit=false`` 且超限时仍返回 True（仅告警）。

        Raises:
            QuotaExceededError: ``hard_limit=true`` 且用户或部门配额超限时抛出。
        """
        if not user_id:
            return True

        # 检查用户配额
        user_used: int = int(await self._redis_op("get", self._user_key(user_id)) or 0)
        if user_used + estimated_tokens > self._default_user_limit:
            msg = (
                f"User {user_id} daily token quota exceeded "
                f"(used: {user_used}, limit: {self._default_user_limit})"
            )
            logger.warning(
                "User quota exceeded",
                user_id=user_id,
                used=user_used,
                limit=self._default_user_limit,
                estimated=estimated_tokens,
                hard_limit=self._hard_limit,
            )
            if self._hard_limit:
                raise QuotaExceededError(msg)

        # 检查部门配额
        if dept:
            dept_used: int = int(await self._redis_op("get", self._dept_key(dept)) or 0)
            if dept_used + estimated_tokens > self._default_dept_limit:
                msg = (
                    f"Department {dept} daily token quota exceeded "
                    f"(used: {dept_used}, limit: {self._default_dept_limit})"
                )
                logger.warning(
                    "Department quota exceeded",
                    dept=dept,
                    used=dept_used,
                    limit=self._default_dept_limit,
                    hard_limit=self._hard_limit,
                )
                if self._hard_limit:
                    raise QuotaExceededError(msg)

        return True

    async def record_usage(
        self,
        user_id: str,
        dept: str,
        tokens: int,
    ) -> None:
        """
        LLM 调用后记录实际 token 用量。

        在 Redis 中更新用户和部门的计数器，
        设置 25 小时 TTL（覆盖时区差异以实现每日重置）。
        """
        if not user_id or tokens <= 0:
            return

        ttl_seconds: int = 25 * 3600  # 25 小时

        # 更新用户配额
        user_key: str = self._user_key(user_id)
        await self._redis_op("incrby", user_key, tokens)
        await self._redis_op("expire", user_key, ttl_seconds)

        # 更新部门配额
        if dept:
            dept_key: str = self._dept_key(dept)
            await self._redis_op("incrby", dept_key, tokens)
            await self._redis_op("expire", dept_key, ttl_seconds)

        # 检查告警阈值
        user_used: int = int(await self._redis_op("get", user_key) or 0)
        if user_used >= int(self._default_user_limit * self._alert_threshold):
            logger.warning(
                "User quota alert threshold reached",
                user_id=user_id,
                used=user_used,
                limit=self._default_user_limit,
                threshold_pct=self._alert_threshold,
            )

    async def get_quota_info(
        self,
        user_id: str,
        dept: str = "",
    ) -> QuotaInfo:
        """获取用户当前的配额信息。"""
        user_used: int = int(await self._redis_op("get", self._user_key(user_id)) or 0)
        return QuotaInfo(
            user_id=user_id,
            department=dept,
            daily_limit=self._default_user_limit,
            used_today=user_used,
            alert_threshold=self._alert_threshold,
        )

    async def reset_quota(self, user_id: str) -> None:
        """重置用户的每日配额（管理员覆盖）。"""
        await self._redis_op("delete", self._user_key(user_id))
        logger.info("User quota reset", user_id=user_id)


# Singleton 实例
_quota_manager: QuotaManager | None = None


def get_quota_manager() -> QuotaManager:
    """返回单例 QuotaManager 实例。"""
    global _quota_manager
    if _quota_manager is None:
        _quota_manager = QuotaManager()
    return _quota_manager
