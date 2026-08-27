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
        # Q5：运维自愈三命令的可选 flag 全部来自配置（默认空），方法体不得硬编码臆造值
        self._force_build_args: list[str] = list(wren.self_heal_force_build_args)
        self._memory_reset_args: list[str] = list(wren.self_heal_memory_reset_args)
        self._context_validate_args: list[str] = list(wren.self_heal_context_validate_args)

    # ================================================================ profile

    async def profile_add(
        self,
        name: str,
        *,
        extra_args: list[str] | None = None,
        project_dir: str | None = None,
    ) -> dict[str, Any]:
        """注册业务数据源连接 profile。

        Args:
            name: profile 名（与 ``iqd_connection.name`` 一致）。
            extra_args: 附加参数（如 ``--connector postgresql``），凭证不传明文。
            project_dir: 目标 wren project 目录（方案 A 多连接）；缺省沿用 cwd。

        Returns:
            ``{"command": ..., "exit_code": 0, "stdout": ...}``。

        Raises:
            IqdCliError: 二进制缺失或命令非零退出。
        """
        args: list[str] = ["profile", "add", name]
        if extra_args:
            args.extend(extra_args)
        return await self._run(args, cwd=project_dir)

    async def context_set_profile(self, name: str, *, project_dir: str | None = None) -> dict[str, Any]:
        """设定当前语义上下文所用 profile。

        Args:
            name: profile 名。
            project_dir: 目标 wren project 目录（方案 A 多连接）；缺省沿用 cwd。

        Returns:
            CLI 调用结果字典。
        """
        return await self._run(["context", "set-profile", name], cwd=project_dir)

    async def context_build(
        self,
        *,
        mdl_dir: str | None = None,
        sql_pairs: list[dict[str, Any]] | None = None,
        instructions: list[dict[str, Any]] | None = None,
        allow_write: bool = True,
        force: bool = False,
        project_dir: str | None = None,
    ) -> dict[str, Any]:
        """构建/部署 MDL（建模同步 push，W4 携带增强物料）。

        Args:
            mdl_dir: MDL 导出目录（``--mdl <dir>``）；缺省由 CLI 默认。
            sql_pairs: few-shot 样本对列表（``{"question": ..., "sql": ...}``）；
                W4 增强物料，经 ``--sql-pairs <json>`` 传入（需 ``--allow-write``）。
            instructions: 业务术语/口径/同义词指令列表
                （``{"title": ..., "content": ...}``）；经 ``--instructions <json>`` 传入。
            allow_write: 是否放行写操作（缺省 True；管理面 context build 为写操作）。
            force: 是否强制重建（附加 ``self_heal_force_build_args`` 配置项）。
            project_dir: 目标 wren project 目录（方案 A 多连接）；缺省沿用 cwd。

        Returns:
            CLI 调用结果字典（含 ``mdl_hash`` 等 stdout 摘要）。
        """
        args: list[str] = ["context", "build"]
        if allow_write:
            args.append("--allow-write")
        if force:
            # 仅 force 时附加（如 --force），来源 self_heal_force_build_args 配置项（Q5）
            args.extend(self._force_build_args)
        if mdl_dir:
            args.extend(["--mdl", mdl_dir])
        if sql_pairs:
            args.extend(["--sql-pairs", json.dumps(sql_pairs, ensure_ascii=False)])
        if instructions:
            args.extend(["--instructions", json.dumps(instructions, ensure_ascii=False)])
        return await self._run(args, cwd=project_dir)

    async def memory_index(self, *, project_dir: str | None = None) -> dict[str, Any]:
        """下发记忆索引（``wren memory index``）。

        将本次 context build 产出的语义记忆（样本对 / 指令）写入 WrenAI 记忆索引，
        使其对问数生效。属于闭环 build+index 的关键第二步。

        Args:
            project_dir: 目标 wren project 目录（方案 A 多连接）；缺省沿用 cwd。

        Returns:
            CLI 调用结果字典（含 ``command`` / ``exit_code`` / ``stdout`` / ``stderr``）。

        Raises:
            IqdCliError: 二进制缺失或命令非零退出（含部署版本未提供 ``memory index`` 子命令）。

        Note:
            调用方需对 ``IqdCliError`` 做容错（Q6）：CLI 缺失/失败不得中断 build 回填，
            仅单独标记 ``index_status=failed``。
        """
        return await self._run(["memory", "index"], cwd=project_dir)

    async def memory_reset(self, *, project_dir: str | None = None) -> dict[str, Any]:
        """清空 WrenAI 记忆索引（``wren memory reset``）。

        运维自愈「重新索引」动作的第一步（重置后再 ``memory index`` 重建索引）。
        可选 flag 来自配置 ``self_heal_memory_reset_args``（Q5），结构命令名词固定。

        Args:
            project_dir: 目标 wren project 目录（方案 A 多连接）；缺省沿用 cwd。

        Returns:
            CLI 调用结果字典。

        Raises:
            IqdCliError: 二进制缺失或命令非零退出。
        """
        return await self._run(["memory", "reset", *self._memory_reset_args], cwd=project_dir)

    async def context_validate(self, *, project_dir: str | None = None) -> dict[str, Any]:
        """校验当前语义上下文（``wren context validate``）。

        运维自愈「模型校验」动作：返回人可读错误摘要（REQ-8），供前端失败横幅展示。
        可选 flag 来自配置 ``self_heal_context_validate_args``（Q5），结构命令名词固定。

        Returns:
            ``{"ok": bool, "summary": str, "raw": str}``：
            - ``ok``：stdout/stderr 中不含 error 关键词；
            - ``summary``：人可读错误摘要（JSON errors/message 数组 或 纯文本首段错误行）；
            - ``raw``：原始 stdout（成功时）或异常字符串（失败时）。

        Note:
            调用方据 ``ok`` / ``summary`` 写回 ``build_status`` / ``build_error``，失败不抛。
        """
        try:
            raw = await self._run(
                ["context", "validate", *self._context_validate_args], cwd=project_dir
            )
        except IqdCliError as exc:
            return {
                "ok": False,
                "summary": self._parse_validate_summary("", str(exc)),
                "raw": str(exc),
            }
        stdout = raw.get("stdout", "")
        stderr = raw.get("stderr", "")
        ok = "error" not in (stdout + stderr).lower()
        return {
            "ok": ok,
            "summary": self._parse_validate_summary(stdout, stderr),
            "raw": stdout,
        }

    @staticmethod
    def _parse_validate_summary(stdout: str, stderr: str) -> str:
        """从 ``context validate`` 的 stdout/stderr 提取人可读错误摘要（REQ-8）。

        优先 JSON 结构化（``errors`` / ``message`` 数组），否则取首段非空错误行（纯文本）。
        两种形态均不臆测字段名，仅做通用兜底解析（W0 校准）。

        Returns:
            人可读错误摘要字符串；无可解析内容时返回空串。
        """
        if (stdout and stdout.strip()) or (stderr and stderr.strip()):
            # 1. JSON 结构化：errors / message 数组优先
            for blob in (stdout, stderr):
                if not blob or not blob.strip():
                    continue
                try:
                    data = json.loads(blob)
                except (ValueError, AttributeError):
                    continue
                if isinstance(data, dict):
                    errors = data.get("errors")
                    if isinstance(errors, list) and errors:
                        parts: list[str] = []
                        for e in errors:
                            if isinstance(e, dict):
                                parts.append(
                                    str(
                                        e.get("message")
                                        or e.get("error")
                                        or e.get("msg")
                                        or e
                                    )
                                )
                            else:
                                parts.append(str(e))
                        if parts:
                            return "; ".join(parts)
                    msg = data.get("message") or data.get("error") or data.get("msg")
                    if isinstance(msg, str) and msg.strip():
                        return msg.strip()
                    if isinstance(msg, list) and msg:
                        return "; ".join(str(m) for m in msg)
            # 2. 纯文本：优先含 error/fail/失败/错误 的行，否则首段非空行
            text = f"{stdout}\n{stderr}"
            lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
            for ln in lines:
                low = ln.lower()
                if "error" in low or "fail" in low or "失败" in ln or "错误" in ln:
                    return ln
            if lines:
                return lines[0]
        return ""

    async def get_current_mdl_hash(self, *, project_dir: str | None = None) -> str | None:
        """取 WrenAI 当前部署的 mdl_hash（S3 漂移检测）。

        包裹 ``wren get mdl``（或读取部署产物）并解析 mdl_hash；WrenAI 不可达 /
        子命令缺失 / 解析失败时**返回 ``None``**（不抛，降级为「不判定漂移」）。

        Args:
            project_dir: 目标 wren project 目录（方案 A 多连接）；缺省沿用 cwd。

        Returns:
            当前 mdl_hash 字符串；不可达或解析失败返回 ``None``。

        Note:
            调用方（漂移检测）需将 ``None`` 视为「无法判定」并跳过漂移标记，避免误伤。
        """
        try:
            result = await self._run(["get", "mdl"], cwd=project_dir)
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

    # ================================================================ project 骨架（方案 A 多连接）

    def ensure_project(self, conn_id: int | str, project_home: str) -> str:
        """初始化单连接 wren project 目录骨架（``wren context init`` 的最小本地等价）。

        方案 A 下每个 IQD 连接对应一个独立 wren project 目录
        （``{wren_projects_root}/{connId}``）。本方法创建目录骨架并写入最小
        ``wren_project.yml`` 占位（不含任何凭证明文，凭证经 ``${ENV}`` 占位由
        WrenMcpProcessManager 启动期注入，见 wren_mcp_registry）。

        真实 profile 注册（``wren profile add``）与首次 ``context set-profile`` 仍由
        运维人工执行（D6：平台不代敲），本方法仅保证目录与 MDL 编译产物落地路径存在，
        使 ``context build`` 能将 ``target/mdl.json`` 写到正确位置（就绪门禁依赖）。

        Args:
            conn_id: 问数连接 id（仅用于目录/yml 命名与日志）。
            project_home: project 绝对目录（已派生 ``{wren_projects_root}/{connId}``）。

        Returns:
            project_home 路径（已确保存在）。

        Raises:
            IqdCliError: 目录无法创建（权限/路径非法）。
        """
        import os

        sub_dirs = [
            "models",
            "views",
            "cubes",
            "relationships",
            "knowledge",
            "target",
            ".wren",
        ]
        try:
            os.makedirs(project_home, exist_ok=True)
            for sub in sub_dirs:
                os.makedirs(os.path.join(project_home, sub), exist_ok=True)
        except OSError as exc:
            raise IqdCliError(f"无法初始化 wren project 目录 {project_home}: {exc}") from exc

        wren_yaml_path = os.path.join(project_home, "wren_project.yml")
        if not os.path.exists(wren_yaml_path):
            # 最小占位：schema_version + name + 空 catalog/data_source/profile 骨架。
            # 真实 catalog/data_source/profile 由 wren CLI 在 profile add / context build 时补全。
            placeholder = (
                "version: 1\n"
                f"name: iqd-conn-{conn_id}\n"
                "catalog:\n"
                "  schema: public\n"
                "data_source:\n"
                "  profile: ''\n"
                "  type: ''\n"
            )
            try:
                with open(wren_yaml_path, "w", encoding="utf-8") as fh:
                    fh.write(placeholder)
            except OSError as exc:
                logger.warning(
                    "IQD wren_project.yml 占位写入失败（非致命，build 时会重建）",
                    conn_id=conn_id,
                    error=str(exc),
                )
        logger.info("IQD wren project ensured", conn_id=conn_id, project_home=project_home)
        return project_home

    # ================================================================ 内部

    async def _run(self, args: list[str], *, cwd: str | None = None) -> dict[str, Any]:
        """执行 wren CLI 子命令。

        Args:
            args: 子命令参数（不含二进制本身）。
            cwd: 子进程工作目录（方案 A 多连接；不传则沿用进程 cwd）。

        Returns:
            含 ``command`` / ``exit_code`` / ``stdout`` / ``stderr`` 的字典。

        Raises:
            IqdCliError: 二进制不可执行或非零退出。
        """
        command: list[str] = [self._bin, *args]
        logger.info("wren CLI call", command=shlex.join(command), cwd=cwd)

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
