"""ConfigFileService — Agent 配置文件的运营台读写服务（T04 O1d / UI#9）。

与 :class:`~src.config_manager.manager.ConfigManager` 的 ``AgentConfig`` 面向
不同：本服务直接操作 ``configs/agents/{agent_id}/`` 下的**原始文件**
（YAML / Markdown），用于运营台「人设与配置文件编辑器」整文件读写。

设计要点（impl-plan §9.3 / §10.3 / spec §3.4）：

* **路径白名单（通配模式）**：``WHITELIST_PATTERNS`` 来自 impl-plan §9.3，
  与磁盘实测对齐（spec §3.4 的 8 条固定路径已失真，见 §11 Q2）。
* **只读文件**：``READONLY_PATTERNS`` —— ``identity/*.yaml`` 与
  ``system/mcp-servers.yaml`` 含访问控制 / 连接密钥，运营台只读（§11 Q2）。
* **密钥脱敏**：读取 ``.yaml`` 时递归把 ``secret/token/api_key/password`` 等
  字段替换为 ``MASKED_VALUE``，响应 ``masked=true``；整体保存含占位符的文件
  被拒绝（``ConfigFileMaskedError``，验收③）。写回时自动从原文件还原真实值
  （即「留空 = 不修改」语义）。
* **校验 + 热更新**：写 ``.yaml`` 走 :class:`ConfigValidator` 结构校验；落盘后
  调 :meth:`ConfigManager.reload_agent` 触发 reload 链路（含
  ``refresh_worker_catalog``，§10.3 约定 11），不自己 ``yaml.safe_dump`` 后
  绕过回调链。
* **永不抛未捕获异常给主链路**：路径越界 / 不存在 / 体积超限都转为明确错误码。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from src.config import get_settings
from src.config_manager.manager import ConfigManager, get_config_manager
from src.config_manager.validator import ConfigValidator, get_config_validator
from src.utils.exceptions import (
    ConfigFileMaskedError,
    ConfigFileTooLargeError,
    ConfigLoadError,
    ConfigPathError,
)
from src.utils.logging import get_logger

logger = get_logger("config_manager.file_service")

#: 脱敏占位符（写回时识别此值并还原真实密钥）。
MASKED_VALUE: str = "***masked***"

#: GET/PUT 体积上限（KB），来自 impl-plan §9.3 ``max_file_size_kb``。
MAX_FILE_SIZE_KB: int = 512

#: YAML 内容体最大字节数（含一定余量）。
MAX_FILE_SIZE_BYTES: int = MAX_FILE_SIZE_KB * 1024

#: 密钥类字段名（大小写不敏感，子串匹配）。
SECRET_KEY_HINTS: tuple[str, ...] = (
    "secret",
    "token",
    "api_key",
    "apikey",
    "password",
    "passwd",
    "private_key",
    "access_key",
    "client_secret",
    "auth_key",
)

#: 可编辑文件白名单（通配模式，impl-plan §9.3）。
WHITELIST_PATTERNS: tuple[str, ...] = (
    "agent.yaml",
    "metadata.yaml",
    "identity/*.yaml",
    "memory/*.yaml",
    "memory/personality.md",
    "memory/facts/**/*.{yaml,md}",
    "runtime/runtime.yaml",
    "runtime/prompts/*.md",
    "skills/enabled-skills.yaml",
    "system/*.yaml",
)

#: 只读文件（运营台不得整体保存，含访问控制 / 连接密钥）。
READONLY_PATTERNS: tuple[str, ...] = (
    "identity/*.yaml",
    "system/mcp-servers.yaml",
)


# ===========================================================================
# 通配模式匹配
# ===========================================================================


def _pattern_to_regex(pattern: str) -> str:
    """把受限通配模式转成正则（支持 ``*`` ``**`` ``?`` ``{a,b}``）。

    Args:
        pattern: 形如 ``memory/facts/**/*.{yaml,md}`` 的白名单模式。

    Returns:
        以 ``^`` / ``$`` 锚定的正则字符串。
    """
    import re

    out_chars: list[str] = []
    i = 0
    n = len(pattern)
    while i < n:
        ch = pattern[i]
        if ch == "*":
            if i + 1 < n and pattern[i + 1] == "*":
                out_chars.append(".*")  # ** 匹配任意（含 /）
                i += 2
                if i < n and pattern[i] == "/":  # 吃掉紧邻的 /
                    i += 1
                continue
            out_chars.append("[^/]*")
        elif ch == "?":
            out_chars.append("[^/]")
        elif ch == "{":
            # 单层 {a,b,c} → (?:a|b|c)（作为正则元字符直接拼接，不转义）
            end = pattern.find("}", i)
            if end == -1:
                out_chars.append(re.escape(ch))
                i += 1
                continue
            options = pattern[i + 1 : end].split(",")
            out_chars.append("(?:" + "|".join(options) + ")")
            i = end + 1
            continue
        else:
            out_chars.append(re.escape(ch))
        i += 1
    return "^" + "".join(out_chars) + "$"


def _compile_patterns(patterns: tuple[str, ...]) -> list[Any]:
    """预编译白名单模式。"""
    import re

    return [re.compile(_pattern_to_regex(p)) for p in patterns]


_COMPILED_WHITELIST: list[Any] | None = None
_COMPILED_READONLY: list[Any] | None = None


def _whitelist_regexes() -> list[Any]:
    global _COMPILED_WHITELIST
    if _COMPILED_WHITELIST is None:
        _COMPILED_WHITELIST = _compile_patterns(WHITELIST_PATTERNS)
    return _COMPILED_WHITELIST


def _readonly_regexes() -> list[Any]:
    global _COMPILED_READONLY
    if _COMPILED_READONLY is None:
        _COMPILED_READONLY = _compile_patterns(READONLY_PATTERNS)
    return _COMPILED_READONLY


def is_whitelisted(rel_path: str) -> bool:
    """判断相对路径是否在可编辑白名单内。

    Args:
        rel_path: 已归一化的相对路径（POSIX 风格）。

    Returns:
        命中任一白名单模式返回 ``True``。
    """
    return any(rx.match(rel_path) for rx in _whitelist_regexes())


def is_readonly(rel_path: str) -> bool:
    """判断相对路径是否为只读文件。

    Args:
        rel_path: 已归一化的相对路径（POSIX 风格）。

    Returns:
        命中任一只读模式返回 ``True``。
    """
    return any(rx.match(rel_path) for rx in _readonly_regexes())


# ===========================================================================
# 路径解析
# ===========================================================================


def agent_dir(agent_id: str) -> Path:
    """返回 ``configs/agents/{agent_id}/`` 目录（不保证存在）。

    Args:
        agent_id: Agent ID（= 目录名）。

    Returns:
        目录 ``Path``。
    """
    base: str = get_settings().CONFIG_BASE_PATH
    return Path(base) / "agents" / agent_id


def resolve_path(agent_id: str, rel_path: str) -> Path:
    """把相对路径解析为绝对文件 ``Path`` 并做安全校验。

    拒绝：空路径、绝对路径、包含 ``..``、不在白名单内的路径。

    Args:
        agent_id: Agent ID。
        rel_path: URL 解码后的相对路径（POSIX 风格，如 ``memory/personality.md``）。

    Returns:
        已校验的服务器文件绝对路径。

    Raises:
        ConfigPathError: 路径非法或越界。
    """
    if not rel_path:
        raise ConfigPathError(rel_path, "empty path")
    # 只允许 POSIX 相对路径，禁止任何绝对 / 父目录逃逸
    if rel_path.startswith("/") or rel_path.startswith("\\"):
        raise ConfigPathError(rel_path, "absolute path not allowed")
    if ".." in rel_path.split("/"):
        raise ConfigPathError(rel_path, "parent directory escape not allowed")
    if rel_path.startswith("./") or rel_path.startswith("../"):
        raise ConfigPathError(rel_path, "relative dot-path not allowed")

    normalized: str = rel_path.replace("\\", "/").strip("/")
    if not normalized or normalized in (".", ".."):
        raise ConfigPathError(rel_path, "invalid relative path")

    if not is_whitelisted(normalized):
        raise ConfigPathError(normalized, "not in editable whitelist")

    return agent_dir(agent_id) / normalized


# ===========================================================================
# 密钥脱敏 / 还原
# ===========================================================================


def _is_secret_key(key: Any) -> bool:
    """判断键名是否命中密钥模式（大小写不敏感子串匹配）。"""
    if not isinstance(key, str):
        return False
    lowered = key.lower()
    return any(hint in lowered for hint in SECRET_KEY_HINTS)


def mask_secrets(data: Any) -> tuple[Any, bool]:
    """递归把密钥字段值替换为脱敏占位符。

    Args:
        data: 解析后的 YAML 结构（dict / list / 标量）。

    Returns:
        ``(脱敏后的结构, 是否发生了脱敏)``。
    """
    masked = False
    if isinstance(data, dict):
        result: dict[str, Any] = {}
        for key, value in data.items():
            if _is_secret_key(key) and isinstance(value, (str, int, float)) and value not in (None, ""):
                result[key] = MASKED_VALUE
                masked = True
            else:
                child, child_masked = mask_secrets(value)
                result[key] = child
                masked = masked or child_masked
        return result, masked
    if isinstance(data, list):
        items: list[Any] = []
        for item in data:
            child, child_masked = mask_secrets(item)
            items.append(child)
            masked = masked or child_masked
        return items, masked
    return data, masked


def restore_masked(original: Any, incoming: Any) -> Any:
    """把 incoming 中等于脱敏占位符的值还原为 original 的真实值。

    用于写回：运营台把脱敏后的内容原样提交时，不会用占位符覆盖真实密钥。

    Args:
        original: 原文件的解析结构。
        incoming: 待保存的解析结构（可能含 ``***masked***``）。

    Returns:
        还原后的结构。
    """
    if isinstance(incoming, dict) and isinstance(original, dict):
        result: dict[str, Any] = {}
        for key, value in incoming.items():
            if (
                isinstance(value, str)
                and value == MASKED_VALUE
                and key in original
            ):
                result[key] = original[key]
            else:
                result[key] = restore_masked(original.get(key), value)
        return result
    if isinstance(incoming, list) and isinstance(original, list):
        return [
            restore_masked(orig_item, inc_item)
            for orig_item, inc_item in zip(original, incoming)
        ]
    return incoming


def contains_masked(data: Any) -> bool:
    """判断结构中是否仍含脱敏占位符（写回前的拒绝判定）。"""
    if isinstance(data, str):
        return data == MASKED_VALUE
    if isinstance(data, dict):
        return any(contains_masked(v) for v in data.values())
    if isinstance(data, list):
        return any(contains_masked(v) for v in data)
    return False


# ===========================================================================
# 对外服务方法
# ===========================================================================


def list_editable_files(agent_id: str) -> list[dict[str, Any]]:
    """列出 Agent 目录下白名单内的可编辑文件（按磁盘实际存在返回，验收②）。

    Args:
        agent_id: Agent ID。

    Returns:
        文件条目列表，每项 ``{ path, type, read_only }``；目录不存在时返回 ``[]``。
    """
    root: Path = agent_dir(agent_id)
    if not root.exists() or not root.is_dir():
        # 未找到 Agent 目录不报错，仅返回空树（与「按磁盘实际返回」一致）。
        return []

    files: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel: str = path.relative_to(root).as_posix()
        if not is_whitelisted(rel):
            continue
        suffix = path.suffix.lower().lstrip(".")
        files.append(
            {
                "path": rel,
                "type": suffix if suffix else "text",
                "read_only": is_readonly(rel),
                "size_bytes": path.stat().st_size,
            }
        )
    return files


def read_config_file(agent_id: str, rel_path: str) -> dict[str, Any]:
    """读取单个配置文件内容。

    ``.yaml`` 文件做密钥脱敏（``masked=true``）；``.md`` 等纯文本不脱敏。

    Args:
        agent_id: Agent ID。
        rel_path: 相对路径（POSIX）。

    Returns:
        ``{ content, masked, read_only, type }``。

    Raises:
        ConfigPathError: 路径非法 / 越界。
        ConfigLoadError: 文件不存在或解析失败。
    """
    abs_path: Path = resolve_path(agent_id, rel_path)
    if not abs_path.exists() or not abs_path.is_file():
        raise ConfigLoadError(str(abs_path))

    raw: str = abs_path.read_text(encoding="utf-8")
    masked = False
    if abs_path.suffix.lower() in (".yaml", ".yml"):
        try:
            parsed: Any = yaml.safe_load(raw) or {}
        except yaml.YAMLError as exc:
            raise ConfigLoadError(str(abs_path), str(exc))
        parsed, masked = mask_secrets(parsed)
        content = yaml.safe_dump(parsed, allow_unicode=True, sort_keys=False)
    else:
        content = raw

    return {
        "content": content,
        "masked": masked,
        "read_only": is_readonly(rel_path.replace("\\", "/").strip("/")),
        "type": abs_path.suffix.lower().lstrip(".") or "text",
    }


def write_config_file(agent_id: str, rel_path: str, content: str) -> dict[str, Any]:
    """写入单个配置文件内容（校验 + 密钥还原 + 热更新）。

    Args:
        agent_id: Agent ID。
        rel_path: 相对路径（POSIX）。
        content: 文件新内容（原始文本）。

    Returns:
        ``{ path, masked, reloaded }``。

    Raises:
        ConfigPathError: 路径非法 / 越界 / 只读。
        ConfigFileTooLargeError: 超过体积上限。
        ConfigFileMaskedError: 整体保存含脱敏占位符。
        ConfigLoadError: YAML 语法错误。
        ConfigValidationError: 结构校验失败。
    """
    abs_path: Path = resolve_path(agent_id, rel_path)
    normalized: str = rel_path.replace("\\", "/").strip("/")

    if is_readonly(normalized):
        raise ConfigPathError(normalized, "read-only file cannot be written")

    if len(content.encode("utf-8")) > MAX_FILE_SIZE_BYTES:
        raise ConfigFileTooLargeError(normalized, MAX_FILE_SIZE_KB)

    # 解析（YAML 做脱敏还原 + 校验；其它类型直接落盘）
    if abs_path.suffix.lower() in (".yaml", ".yml"):
        try:
            incoming: Any = yaml.safe_load(content)
        except yaml.YAMLError as exc:
            raise ConfigLoadError(str(abs_path), str(exc))

        if not isinstance(incoming, (dict, list)):
            # 顶级必须是映射 / 序列，否则视为非法内容
            from src.utils.exceptions import ConfigValidationError

            raise ConfigValidationError([f"{normalized}: top-level must be a mapping or sequence"])

        if contains_masked(incoming):
            raise ConfigFileMaskedError(normalized)

        # 若原文件存在，先还原密钥占位符，避免覆盖真实密钥
        if abs_path.exists():
            try:
                original_parsed: Any = yaml.safe_load(abs_path.read_text(encoding="utf-8")) or {}
            except yaml.YAMLError:
                original_parsed = {}
            incoming = restore_masked(original_parsed, incoming)

        # 结构校验（复用既有 ConfigValidator）
        validator: ConfigValidator = get_config_validator()
        errors: list[str] = validator.validate_yaml_dict(
            incoming if isinstance(incoming, dict) else {"agent": {}}
        )
        if errors:
            from src.utils.exceptions import ConfigValidationError

            raise ConfigValidationError(errors)

        # 以还原后的结构重新序列化为落盘内容（保持脱敏前真实值）
        save_text: str = yaml.safe_dump(incoming, allow_unicode=True, sort_keys=False)
    else:
        save_text = content

    # 落盘（只写文件；不绕过回调链）
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_text(save_text, encoding="utf-8")

    # 触发 ConfigManager 热更新链路（含 WorkerCatalog 刷新）
    reloaded = False
    try:
        manager: ConfigManager = get_config_manager()
        result = manager.reload_agent(agent_id)
        reloaded = result is not None
    except Exception as exc:  # noqa: BLE001 - 写文件成功即视为成功，reload 失败仅告警
        logger.warning(
            "write_config_file: reload_agent failed",
            agent_id=agent_id,
            path=normalized,
            error=str(exc),
        )

    return {"path": normalized, "masked": False, "reloaded": reloaded}
