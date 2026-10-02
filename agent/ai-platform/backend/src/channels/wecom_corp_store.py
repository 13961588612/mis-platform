"""企微 corp 配置存储 —— ``configs/channels/wecom-corps.yaml``（读写）。

依据 ``wecom-user-binding-design.md`` §8.2：机器人长连接只用 ``BotID + Secret``，
**通讯录读取**需要按 ``corp_id`` 维度的企微应用凭证；本文件维护
``corp_id → tenant_id / secret_ref / user_bind_mode`` 映射。

运营台（方案 B）可在页面上新增 / 编辑 / 删除企业条目，因此本 Store 与
:class:`~src.channels.wecom_bot_store.WecomBotStore` 完全同构：协程锁串行化写、
先写临时文件再 ``os.replace`` 原子落盘、mtime 感知惰性重载、变更回调。

**密钥不落 YAML**：企业条目里的 ``secret_ref`` 默认写成规范引用
``secret://wecom/corp/<corp_id>``；真实 corpsecret 经
:class:`~src.identity.credential_vault.CredentialVault` 加密存到
``ai_platform.credential_mappings``。YAML 里永远只有引用，没有明文。

也兼容部署侧手工写的 ``env:<NAME>`` / 明文 / 留空（回退全局 ``WECOM_SECRET``），
这些条目的密钥由配置文件或环境变量管理，运营台只读展示其「已配置」状态。
"""

from __future__ import annotations

import asyncio
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Callable, Literal

import yaml
import structlog
from pydantic import BaseModel, Field, field_validator

from src.config import Settings, get_settings
from src.utils.exceptions import AIPlatformError

logger = structlog.get_logger(__name__)

#: 文件 schema 版本。
CORP_CONFIG_VERSION: int = 1

#: 单文件最多允许的企业数量（防止误操作把文件撑爆）。
MAX_CORPS: int = 200

#: 密钥引用前缀：``secret://wecom/corp/<corp_id>``。
SECRET_REF_PREFIX: str = "secret://wecom/corp/"

#: 用户绑定模式：
#: ``auto_phone`` = 首次无绑定时按手机号 exact-one 自动绑定；
#: ``manual_only`` = 只允许运营台人工绑定；
#: ``disabled`` = 该 corp 不参与绑定（入站一律 fail-closed）。
BindMode = Literal["auto_phone", "manual_only", "disabled"]

_ALLOWED_BIND_MODES: frozenset[str] = frozenset(
    {"auto_phone", "manual_only", "disabled"}
)


def canonical_secret_ref(corp_id: str) -> str:
    """返回某个 corp 的规范密钥引用（``secret://wecom/corp/<corp_id>``）。"""
    return f"{SECRET_REF_PREFIX}{(corp_id or '').strip()}"


def is_vault_ref(secret_ref: str) -> bool:
    """判断 ``secret_ref`` 是否为 Vault 引用（``secret://`` 前缀）。"""
    return (secret_ref or "").strip().startswith("secret://")


class WecomCorpNotFoundError(AIPlatformError):
    """请求的企业配置不存在。"""

    def __init__(self, corp_id: str) -> None:
        super().__init__(f"WeCom corp not found: {corp_id}", code=5001)
        self.corp_id: str = corp_id


class WecomCorpConflictError(AIPlatformError):
    """企业数量超限或 corp_id 重复等业务冲突。"""

    def __init__(self, message: str) -> None:
        super().__init__(message, code=5002)


class WecomCorpRecord(BaseModel):
    """``corps[]`` 中的一条企业配置。"""

    corp_id: str = Field(..., min_length=1, max_length=64, description="企微企业 ID")
    tenant_id: int = Field(..., description="对应 MIS 租户 ID")
    name: str = Field(default="", max_length=128, description="企业名称")
    secret_ref: str = Field(
        default="", max_length=256, description="企微应用 secret 引用（Vault / env / 明文）"
    )
    user_bind_mode: BindMode = Field(default="auto_phone", description="用户绑定模式")

    @field_validator("corp_id", "name", "secret_ref", mode="before")
    @classmethod
    def _coerce_str(cls, value: Any) -> str:
        """把 ``None`` / 非字符串安全折叠成去除首尾空白的字符串。"""
        if value is None:
            return ""
        return str(value).strip()

    @field_validator("user_bind_mode", mode="before")
    @classmethod
    def _coerce_mode(cls, value: Any) -> str:
        """非法绑定模式一律降级为 ``manual_only``（更保守，不会误自动绑定）。"""
        text = str(value or "").strip().lower()
        return text if text in _ALLOWED_BIND_MODES else "manual_only"

    def to_yaml_dict(self) -> dict[str, Any]:
        """序列化为 YAML 落盘用的字典（字段顺序稳定，便于 diff）。"""
        return {
            "corp_id": self.corp_id,
            "tenant_id": self.tenant_id,
            "name": self.name,
            "secret_ref": self.secret_ref,
            "user_bind_mode": self.user_bind_mode,
        }


class WecomCorpCreateRequest(BaseModel):
    """#64 新建企业请求体。"""

    corp_id: str = Field(..., min_length=1, max_length=64)
    tenant_id: int = Field(..., description="对应 MIS 租户 ID")
    name: str = Field(default="", max_length=128)
    user_bind_mode: BindMode = Field(default="auto_phone")

    @field_validator("corp_id", "name", mode="before")
    @classmethod
    def _strip(cls, value: Any) -> str:
        return "" if value is None else str(value).strip()

    @field_validator("user_bind_mode", mode="before")
    @classmethod
    def _coerce_mode(cls, value: Any) -> str:
        text = str(value or "").strip().lower()
        return text if text in _ALLOWED_BIND_MODES else "manual_only"


class WecomCorpUpdateRequest(BaseModel):
    """#65 更新企业请求体（缺省字段 = 不修改）。"""

    tenant_id: int | None = Field(default=None)
    name: str | None = Field(default=None, max_length=128)
    user_bind_mode: BindMode | None = Field(default=None)

    @field_validator("name", mode="before")
    @classmethod
    def _strip_optional(cls, value: Any) -> str | None:
        return None if value is None else str(value).strip()


class WecomCorpStore:
    """``configs/channels/wecom-corps.yaml`` 的读写门面。

    线程/协程安全：所有变更方法串行化在 :attr:`_lock` 上；读方法基于 mtime 做
    惰性重载，读到的是不可变快照（返回 copy，调用方改不脏内存）。
    """

    def __init__(self, path: Path | None = None) -> None:
        """初始化并加载一次。

        Args:
            path: 显式 YAML 路径；``None`` 时按 settings 推导。
        """
        self._explicit_path: Path | None = path
        self._corps: dict[str, WecomCorpRecord] = {}
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
        """解析出实际读取的 YAML 路径。"""
        if self._explicit_path is not None:
            return self._explicit_path
        settings: Settings = get_settings()
        raw: Path = Path(settings.WECOM_CORP_CONFIG_FILE)
        if raw.is_absolute():
            return raw
        return Path(settings.CONFIG_BASE_PATH) / raw

    def _current_mtime(self) -> float:
        try:
            return self.path.stat().st_mtime
        except OSError:
            return -1.0

    def _load(self, force: bool = False) -> None:
        """按 mtime 差量加载；失败保持上一份快照，不抛异常。"""
        mtime: float = self._current_mtime()
        if not force and mtime == self._mtime:
            return
        path: Path = self.path
        if mtime < 0:
            self._corps = {}
            self._order = []
            self._mtime = mtime
            return
        try:
            raw: Any = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError) as exc:
            logger.error(
                "Failed to load wecom corps config, keeping snapshot",
                path=str(path),
                error=str(exc),
            )
            return
        if not isinstance(raw, dict):
            logger.error("wecom corps config root is not a mapping", path=str(path))
            return
        items: Any = raw.get("corps") or []
        if not isinstance(items, list):
            logger.error("wecom corps config `corps` is not a list", path=str(path))
            return
        parsed: dict[str, WecomCorpRecord] = {}
        order: list[str] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            try:
                record = WecomCorpRecord(**item)
            except Exception as exc:  # noqa: BLE001 - 单条非法只跳过该条
                logger.error("wecom corps item invalid", item=item, error=str(exc))
                continue
            if record.corp_id in parsed:
                order.remove(record.corp_id)
            parsed[record.corp_id] = record
            order.append(record.corp_id)
        self._corps = parsed
        self._order = order
        self._mtime = mtime

    def _persist(self) -> None:
        """把内存快照原子落盘（先写临时文件再 ``os.replace``）。"""
        path: Path = self.path
        payload: dict[str, Any] = {
            "version": CORP_CONFIG_VERSION,
            "corps": [self._corps[cid].to_yaml_dict() for cid in self._order],
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
            try:
                if tmp_path.exists():
                    tmp_path.unlink()
            except OSError:
                pass
            logger.error("Failed to persist wecom corps config", path=str(path), error=str(exc))
            raise AIPlatformError(f"Failed to persist wecom corps config: {exc}", code=9000)
        self._mtime = self._current_mtime()

    # -------------------------------------------------------------------
    # 变更回调
    # -------------------------------------------------------------------

    def on_change(self, callback: Callable[[str, str], Any]) -> None:
        """注册变更回调 ``callback(corp_id, change_type)``。"""
        self._on_change_callbacks.append(callback)

    async def _notify(self, corp_id: str, change_type: str) -> None:
        """触发所有已注册回调；单个回调异常不影响其他回调与主链路。"""
        for callback in self._on_change_callbacks:
            try:
                result: Any = callback(corp_id, change_type)
                if hasattr(result, "__await__"):
                    await result
            except Exception as exc:  # noqa: BLE001
                logger.error(
                    "WeCom corp change callback failed",
                    corp_id=corp_id,
                    change_type=change_type,
                    error=str(exc),
                )

    # -------------------------------------------------------------------
    # 读
    # -------------------------------------------------------------------

    def get(self, corp_id: str) -> WecomCorpRecord | None:
        """按 ``corp_id`` 取企业配置；未配置返回 ``None``。"""
        if not corp_id:
            return None
        self._load()
        record = self._corps.get(corp_id)
        return record.model_copy(deep=True) if record is not None else None

    def list_corps(self) -> list[WecomCorpRecord]:
        """返回全部已配置企业（副本）。"""
        self._load()
        return [self._corps[cid].model_copy(deep=True) for cid in self._order]

    def list_wire(self, *, secret_configured: dict[str, bool] | None = None) -> list[dict[str, Any]]:
        """返回运营台契约形态的企业列表。

        明文 corpsecret 永不下发：只给 ``secret_configured`` 布尔与引用类型。
        """
        flags = secret_configured or {}
        out: list[dict[str, Any]] = []
        for record in self.list_corps():
            ref = record.secret_ref or ""
            if is_vault_ref(ref):
                ref_kind = "vault"
            elif ref.startswith("env:"):
                ref_kind = "env"
            elif ref:
                ref_kind = "inline"
            else:
                ref_kind = "global"
            wire = {
                "corp_id": record.corp_id,
                "tenant_id": record.tenant_id,
                "name": record.name,
                "secret_ref": ref,
                "secret_ref_kind": ref_kind,
                "secret_configured": bool(flags.get(record.corp_id, False)),
                "user_bind_mode": record.user_bind_mode,
            }
            out.append(wire)
        return out

    # -------------------------------------------------------------------
    # 写
    # -------------------------------------------------------------------

    async def create(self, payload: WecomCorpCreateRequest) -> WecomCorpRecord:
        """新增一个企业条目（#64）。"""
        async with self._lock:
            self._load()
            if len(self._corps) >= MAX_CORPS:
                raise WecomCorpConflictError(f"Too many wecom corps (max={MAX_CORPS})")
            if payload.corp_id in self._corps:
                raise WecomCorpConflictError(f"WeCom corp already exists: {payload.corp_id}")
            record = WecomCorpRecord(
                corp_id=payload.corp_id,
                tenant_id=payload.tenant_id,
                name=payload.name,
                secret_ref=canonical_secret_ref(payload.corp_id),
                user_bind_mode=payload.user_bind_mode,
            )
            self._corps[record.corp_id] = record
            self._order.append(record.corp_id)
            self._persist()
        await self._notify(record.corp_id, "created")
        return record.model_copy(deep=True)

    async def update(self, corp_id: str, payload: WecomCorpUpdateRequest) -> WecomCorpRecord:
        """更新企业条目（#65）；缺省字段 = 不修改。"""
        async with self._lock:
            self._load()
            record = self._corps.get(corp_id)
            if record is None:
                raise WecomCorpNotFoundError(corp_id)
            if payload.tenant_id is not None:
                record.tenant_id = payload.tenant_id
            if payload.name is not None:
                record.name = payload.name
            if payload.user_bind_mode is not None:
                record.user_bind_mode = payload.user_bind_mode
            self._persist()
        await self._notify(corp_id, "updated")
        return record.model_copy(deep=True)

    async def delete(self, corp_id: str) -> bool:
        """删除企业条目（#66）；不存在返回 ``False``（幂等）。"""
        async with self._lock:
            self._load()
            if corp_id not in self._corps:
                return False
            del self._corps[corp_id]
            if corp_id in self._order:
                self._order.remove(corp_id)
            self._persist()
        await self._notify(corp_id, "deleted")
        return True

    async def set_secret_ref(self, corp_id: str, secret_ref: str) -> WecomCorpRecord:
        """单独更新密钥引用（运营台配密钥后把引用写成规范 vault 引用）。"""
        async with self._lock:
            self._load()
            record = self._corps.get(corp_id)
            if record is None:
                raise WecomCorpNotFoundError(corp_id)
            record.secret_ref = (secret_ref or "").strip()
            self._persist()
        await self._notify(corp_id, "updated")
        return record.model_copy(deep=True)


@lru_cache(maxsize=1)
def get_wecom_corp_store() -> WecomCorpStore:
    """返回进程级单例 :class:`WecomCorpStore`。"""
    return WecomCorpStore()
