"""IqdCli — 本地 wren CLI 封装（v1.9 / B2 管理面）。

负责 MDL 构建/部署与 profile 管理（architecture §4.4②）：
- ``wren profile add <name>``      注册业务数据源连接（凭证由 profile 注入）
- ``wren context set-profile <name>`` 设定当前语义上下文所用 profile
- ``wren context build [--mdl <dir>]`` 构建/部署 MDL（建模同步 push）

管理面走本地 CLI，**不走 MCP 写**（``wren_mcp_allow_write=false``）。
subprocess 直调 ``wren_cli_bin``，输出含敏感信息时按行脱敏记录。
"""

from __future__ import annotations

from typing import Any

import asyncio
import json
import shlex

from src.config import get_settings
from src.utils.logging import get_logger

logger = get_logger("adapters.iqd_cli")


class IqdCliError(RuntimeError):
    """wren CLI 调用异常（二进制缺失 / 非零退出）。"""


class IqdCli:
    """本地 wren CLI 封装。

    默认从全局 ``Settings.iqd_mcp``（:class:`IqdMcpSettings`）读取
    ``wren_cli_bin``。所有方法均为异步（subprocess 不阻塞事件循环）。
    """

    def __init__(self, *, bin_path: str | None = None, timeout: float | None = None) -> None:
        """初始化 CLI 封装。

        Args:
            bin_path: wren 可执行文件（缺省取 ``WREN_CLI_BIN``，默认 ``wren``）。
            timeout: 单次 CLI 调用超时秒数（缺省 ``WREN_MCP_TIMEOUT_SECONDS``）。
        """
        settings = get_settings()
        wren = settings.iqd_mcp
        self._bin: str = bin_path or wren.wren_cli_bin
        self._timeout: float = timeout if timeout is not None else wren.wren_mcp_timeout_seconds

    # ================================================================ profile

    async def profile_add(self, name: str, *, extra_args: list[str] | None = None) -> dict[str, Any]:
        """注册业务数据源连接 profile。

        Args:
            name: profile 名（与 ``iqd_connection.name`` 一致）。
            extra_args: 附加参数（如 ``--connector postgresql``），凭证不传明文。

        Returns:
            ``{"command": ..., "exit_code": 0, "stdout": ...}``。

        Raises:
            IqdCliError: 二进制缺失或命令非零退出。
        """
        args: list[str] = ["profile", "add", name]
        if extra_args:
            args.extend(extra_args)
        return await self._run(args)

    async def context_set_profile(self, name: str) -> dict[str, Any]:
        """设定当前语义上下文所用 profile。

        Args:
            name: profile 名。

        Returns:
            CLI 调用结果字典。
        """
        return await self._run(["context", "set-profile", name])

    async def context_build(
        self,
        *,
        mdl_dir: str | None = None,
        sql_pairs: list[dict[str, Any]] | None = None,
        instructions: list[dict[str, Any]] | None = None,
        allow_write: bool = True,
    ) -> dict[str, Any]:
        """构建/部署 MDL（建模同步 push，W4 携带增强物料）。

        Args:
            mdl_dir: MDL 导出目录（``--mdl <dir>``）；缺省由 CLI 默认。
            sql_pairs: few-shot 样本对列表（``{"question": ..., "sql": ...}``）；
                W4 增强物料，经 ``--sql-pairs <json>`` 传入（需 ``--allow-write``）。
            instructions: 业务术语/口径/同义词指令列表
                （``{"title": ..., "content": ...}``）；经 ``--instructions <json>`` 传入。
            allow_write: 是否放行写操作（缺省 True；管理面 context build 为写操作）。

        Returns:
            CLI 调用结果字典（含 ``mdl_hash`` 等 stdout 摘要）。
        """
        args: list[str] = ["context", "build"]
        if allow_write:
            args.append("--allow-write")
        if mdl_dir:
            args.extend(["--mdl", mdl_dir])
        if sql_pairs:
            args.extend(["--sql-pairs", json.dumps(sql_pairs, ensure_ascii=False)])
        if instructions:
            args.extend(["--instructions", json.dumps(instructions, ensure_ascii=False)])
        return await self._run(args)

    async def memory_index(self) -> dict[str, Any]:
        """下发记忆索引（``wren memory index``）。

        将本次 context build 产出的语义记忆（样本对 / 指令）写入 WrenAI 记忆索引，
        使其对问数生效。属于闭环 build+index 的关键第二步。

        Returns:
            CLI 调用结果字典（含 ``command`` / ``exit_code`` / ``stdout`` / ``stderr``）。

        Raises:
            IqdCliError: 二进制缺失或命令非零退出（含部署版本未提供 ``memory index`` 子命令）。

        Note:
            调用方需对 ``IqdCliError`` 做容错（Q6）：CLI 缺失/失败不得中断 build 回填，
            仅单独标记 ``index_status=failed``。
        """
        return await self._run(["memory", "index"])

    async def get_current_mdl_hash(self) -> str | None:
        """取 WrenAI 当前部署的 mdl_hash（S3 漂移检测）。

        包裹 ``wren get mdl``（或读取部署产物）并解析 mdl_hash；WrenAI 不可达 /
        子命令缺失 / 解析失败时**返回 ``None``**（不抛，降级为「不判定漂移」）。

        Returns:
            当前 mdl_hash 字符串；不可达或解析失败返回 ``None``。

        Note:
            调用方（漂移检测）需将 ``None`` 视为「无法判定」并跳过漂移标记，避免误伤。
        """
        try:
            result = await self._run(["get", "mdl"])
        except IqdCliError as exc:
            logger.warning("IQD get current mdl_hash failed (degraded to None)", error=str(exc))
            return None
        stdout = result.get("stdout", "") if isinstance(result, dict) else ""
        return self._parse_mdl_hash(stdout) if stdout else None

    @staticmethod
    def _parse_mdl_hash(stdout: str) -> str | None:
        """从 wren get mdl 的 stdout 提取 mdl_hash（与 service 解析口径一致）。

        优先 JSON 解析（``mdl_hash`` / ``hash`` / ``deployment_id``），失败回退带前缀
        正则提取；均失败返回 ``None``（不可判定，交由调用方降级）。
        """
        if not stdout or not stdout.strip():
            return None
        try:
            data = json.loads(stdout)
            if isinstance(data, dict):
                for key in ("mdl_hash", "hash", "deployment_id", "mdlHash", "deploymentId"):
                    val = data.get(key)
                    if isinstance(val, str) and val.strip():
                        return val.strip()
        except (ValueError, AttributeError):
            match = re.search(
                r"(?:mdl_hash|hash|deployment_id)['\"]?\s*[:=]\s*['\"]?([A-Za-z0-9_\-]+)",
                stdout,
            )
            if match:
                return match.group(1)
        return None

    # ================================================================ 内部

    async def _run(self, args: list[str]) -> dict[str, Any]:
        """执行 wren CLI 子命令。

        Args:
            args: 子命令参数（不含二进制本身）。

        Returns:
            含 ``command`` / ``exit_code`` / ``stdout`` / ``stderr`` 的字典。

        Raises:
            IqdCliError: 二进制不可执行或非零退出。
        """
        command: list[str] = [self._bin, *args]
        logger.info("wren CLI call", command=shlex.join(command))

        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
        except FileNotFoundError as exc:
            raise IqdCliError(f"wren CLI 不可用: {self._bin}") from exc

        try:
            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                proc.communicate(), timeout=self._timeout
            )
        except TimeoutError as exc:
            proc.kill()
            raise IqdCliError(f"wren CLI 超时(>{self._timeout}s): {shlex.join(command)}") from exc

        stdout: str = (stdout_bytes or b"").decode("utf-8", errors="replace")
        stderr: str = (stderr_bytes or b"").decode("utf-8", errors="replace")

        if proc.returncode != 0:
            raise IqdCliError(
                f"wren CLI 失败 exit={proc.returncode}: {shlex.join(command)}\n"
                f"stderr: {stderr[:500]}"
            )

        logger.info("wren CLI done", exit_code=proc.returncode, stdout_len=len(stdout))
        return {
            "command": shlex.join(command),
            "exit_code": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
        }
