"""配置项安全读取helper（Coordinator 内部工具）。

`get_settings()` 在单测中常被 `MagicMock(...)` 整体替换，只显式声明少数属性；
直接 `settings.NEW_FLAG` 会拿到一个**恒真的 MagicMock**，导致新开关在既有
测试里被意外打开、破坏回归红线（见 design-impl.md §7.5）。

因此所有**新增**配置项一律通过本模块读取：只接受真实的 ``bool`` / ``int`` /
``str`` 值，其余一切（含 MagicMock）回落到显式默认值。
"""

from __future__ import annotations

from typing import Any

_TRUE_LITERALS: frozenset[str] = frozenset({"1", "true", "yes", "on", "y", "t"})
_FALSE_LITERALS: frozenset[str] = frozenset({"0", "false", "no", "off", "n", "f"})


def bool_flag(settings: Any, name: str, default: bool) -> bool:
    """安全读取布尔配置项。

    Args:
        settings: `Settings` 实例（也可能是测试用的 Mock 对象）。
        name: 配置项名称。
        default: 取不到真实布尔值时的回落默认值。

    Returns:
        解析后的布尔值；无法解析时返回 ``default``。
    """
    value = getattr(settings, name, None)
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in _TRUE_LITERALS:
            return True
        if lowered in _FALSE_LITERALS:
            return False
    return default


def int_flag(
    settings: Any,
    name: str,
    default: int,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    """安全读取整数配置项，并做上下界裁剪。

    Args:
        settings: `Settings` 实例（也可能是测试用的 Mock 对象）。
        name: 配置项名称。
        default: 取不到真实整数时的回落默认值。
        minimum: 下界（含）；`None` 表示不限制。
        maximum: 上界（含）；`None` 表示不限制。

    Returns:
        裁剪后的整数值。
    """
    value = getattr(settings, name, None)
    resolved = default
    if isinstance(value, bool):
        resolved = default
    elif isinstance(value, int):
        resolved = value
    elif isinstance(value, str):
        try:
            resolved = int(value.strip())
        except (TypeError, ValueError):
            resolved = default
    if minimum is not None:
        resolved = max(minimum, resolved)
    if maximum is not None:
        resolved = min(maximum, resolved)
    return resolved


def str_flag(
    settings: Any,
    name: str,
    default: str,
    *,
    allowed: tuple[str, ...] | None = None,
) -> str:
    """安全读取字符串配置项。

    Args:
        settings: `Settings` 实例（也可能是测试用的 Mock 对象）。
        name: 配置项名称。
        default: 取不到真实字符串时的回落默认值。
        allowed: 允许的取值集合；不在集合内时回落 ``default``。

    Returns:
        解析后的字符串值。
    """
    value = getattr(settings, name, None)
    resolved = value.strip() if isinstance(value, str) and value.strip() else default
    if allowed is not None and resolved not in allowed:
        return default
    return resolved
