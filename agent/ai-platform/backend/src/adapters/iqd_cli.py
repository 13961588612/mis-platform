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
import re
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
        """构建/部署 MDL（建模同步 push）。

        当前 WrenAI CLI（真机 ``wren context build --help``）仅支持
        ``--path/--from-osi/--data-source/--output/--validate``，**不再**接受
        ``--allow-write`` / ``--mdl`` / ``--sql-pairs`` / ``--instructions``。

        - 无 ``mdl_dir``：在 ``project_dir`` 下执行 ``wren context build``（读 YAML 工程）。
        - 有 ``mdl_dir``（含 ``manifest.json``）：跨机器时由 agent 写入
          ``{project}/target/mdl.json`` 直接部署；本地同目录落盘后仍跑一次 build 作校验
          （若仅有 manifest、无 YAML 模型，build 可能 no-op/失败，以落盘为准）。
        - ``sql_pairs`` / ``instructions``：改为写 ``knowledge/``（后续接 ``memory store``）；
          本期先跳过并打 warning，避免 CLI 因未知 option 失败。

        Args:
            mdl_dir: 派生 MDL 目录（内含 ``manifest.json``）；缺省则纯 project build。
            sql_pairs: few-shot 样本（本期跳过 CLI 直传）。
            instructions: 业务指令（本期跳过 CLI 直传）。
            allow_write: 保留参数兼容旧调用方；**已忽略**（新 CLI 无此 flag）。
            force: 是否附加 ``self_heal_force_build_args``。
            project_dir: 目标 wren project 目录（方案 A 多连接）。

        Returns:
            CLI 调用结果字典（含 ``mdl_hash`` 等 stdout 摘要）。
        """
        del allow_write  # 旧 flag，当前 CLI 不支持
        if sql_pairs:
            logger.warning(
                "IQD context_build skip sql_pairs (CLI 无 --sql-pairs；改走 knowledge/ TODO)",
                count=len(sql_pairs),
            )
        if instructions:
            logger.warning(
                "IQD context_build skip instructions (CLI 无 --instructions；改走 knowledge/ TODO)",
                count=len(instructions),
            )

        args: list[str] = ["context", "build"]
        if force:
            args.extend(self._force_build_args)
        # --mdl 仅作内部标记：远程 _try_remote_run 抽出 manifest 交给 agent 写 target/mdl.json；
        # 本地则直接写入 project_dir/target/mdl.json，不再传给 wren CLI。
        if mdl_dir:
            import os
            import shutil

            manifest_src = (
                mdl_dir
                if mdl_dir.endswith("manifest.json")
                else os.path.join(mdl_dir, "manifest.json")
            )
            if project_dir:
                target_dir = os.path.join(project_dir, "target")
                os.makedirs(target_dir, exist_ok=True)
                dest = os.path.join(target_dir, "mdl.json")
                try:
                    shutil.copyfile(manifest_src, dest)
                except OSError as exc:
                    raise IqdCliError(f"写入 target/mdl.json 失败: {exc}") from exc
                # 跨机器时仍带 --mdl 标记，供 _try_remote_run 上传同一份 manifest
                args.extend(["--mdl", mdl_dir])
            else:
                args.extend(["--mdl", mdl_dir])
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

        运维自愈「模型校验」动作：返回人可读错误/警告摘要（REQ-8），供前端结果面板展示。
        可选 flag 来自配置 ``self_heal_context_validate_args``（Q5），结构命令名词固定。

        <p><b>警告 ≠ 失败</b>：Wren 在仅有 warning 时也常 ``exit != 0``。本方法以
        ``allow_nonzero`` 收下完整 stdout/stderr，再按解析结果判定 ``ok``——
        「N warning(s), 0 errors」视为通过（带 warnings），不得把运维自愈标成 failed。

        Returns:
            ``{"ok": bool, "summary": str, "raw": str, "warnings": list[str], "errors": list[str]}``。
        """
        try:
            raw = await self._run(
                ["context", "validate", *self._context_validate_args],
                cwd=project_dir,
                allow_nonzero=True,
            )
        except IqdCliError as exc:
            # 尽量从异常文案里再判一次：仅警告不算基础设施失败
            parsed = self._parse_validate_output("", str(exc))
            warn_n, err_n = parsed.get("warn_count"), parsed.get("error_count")
            soft_ok = (
                not parsed["errors"]
                and (
                    bool(parsed["warnings"])
                    or (err_n == 0 and warn_n is not None)
                )
                and not self._looks_like_hard_failure(str(exc))
            )
            if soft_ok or (err_n == 0 and (warn_n or 0) > 0 and not parsed["errors"]):
                return {
                    "ok": True,
                    "summary": parsed["summary"],
                    "raw": str(exc),
                    "warnings": parsed["warnings"]
                    or (
                        [
                            f"检测到 {warn_n} 条警告，但 CLI 未输出明细。"
                            "请在 wren 机执行 `wren context validate` 查看逐条内容。"
                        ]
                        if warn_n
                        else []
                    ),
                    "errors": [],
                }
            return {
                "ok": False,
                "summary": parsed["summary"] or str(exc),
                "raw": str(exc),
                "warnings": parsed["warnings"],
                "errors": parsed["errors"]
                or ([parsed["summary"]] if parsed["summary"] else [str(exc)]),
            }
        stdout = str(raw.get("stdout") or "")
        stderr = str(raw.get("stderr") or "")
        parsed = self._parse_validate_output(stdout, stderr)
        warn_n, err_n = parsed.get("warn_count"), parsed.get("error_count")
        # 有真实 errors → 失败；计数摘要「0 errors」或仅有 warnings → 通过（不算运维 failed）
        if parsed["errors"] or (err_n is not None and err_n > 0):
            ok = False
        elif parsed["warnings"] or (warn_n is not None and warn_n >= 0 and err_n == 0):
            ok = True
        else:
            ok = not self._looks_like_hard_failure(f"{stdout}\n{stderr}")
        return {
            "ok": ok,
            "summary": parsed["summary"],
            "raw": (stdout + ("\n" + stderr if stderr else "")).strip(),
            "warnings": parsed["warnings"],
            "errors": parsed["errors"],
        }

    @staticmethod
    def _looks_like_hard_failure(text: str) -> bool:
        """粗判是否像硬失败（排除「N warning(s), 0 errors」计数行）。"""
        if not text or not text.strip():
            return False
        if IqdCli._COUNT_SUMMARY_RE.search(text):
            m = IqdCli._COUNT_SUMMARY_RE.search(text)
            if m and int(m.group("err")) == 0:
                return False
        low = text.lower()
        for ln in text.splitlines():
            s = ln.strip()
            if not s:
                continue
            if IqdCli._COUNT_SUMMARY_RE.search(s):
                continue
            low_ln = s.lower()
            if "error:" in low_ln or low_ln.startswith("error ") or "失败" in s:
                return True
            if "fail" in low_ln and "0 fail" not in low_ln:
                return True
        return "traceback" in low or "panic" in low

    @staticmethod
    def _parse_validate_summary(stdout: str, stderr: str) -> str:
        """兼容旧调用：仅返回摘要字符串（REQ-8）。"""
        return IqdCli._parse_validate_output(stdout, stderr)["summary"]

    # Wren 常见收尾行：`3 warning(s), 0 errors.`
    _COUNT_SUMMARY_RE = re.compile(
        r"(?P<warn>\d+)\s*warning\(s\)\s*,\s*(?P<err>\d+)\s*errors?\.?",
        re.IGNORECASE,
    )

    @staticmethod
    def _parse_validate_output(stdout: str, stderr: str) -> dict[str, Any]:
        """从 ``context validate`` 的 stdout/stderr 提取摘要与分条警告/错误。

        优先 JSON 结构化（``errors`` / ``warnings`` / ``message``），否则按行拆分纯文本。
        计数摘要行（``N warning(s), 0 errors``）**不算 error**，且仅在无明细时作占位。

        Returns:
            ``{"summary", "warnings", "errors", "warn_count", "error_count"}``；
            count 字段在未解析到计数行时为 ``None``。
        """
        warnings: list[str] = []
        errors: list[str] = []
        warn_count: int | None = None
        error_count: int | None = None

        def _as_msgs(items: Any) -> list[str]:
            out: list[str] = []
            if not isinstance(items, list):
                return out
            for e in items:
                if isinstance(e, dict):
                    text = str(
                        e.get("message") or e.get("error") or e.get("msg") or e.get("detail") or e
                    ).strip()
                else:
                    text = str(e).strip()
                if text:
                    out.append(text)
            return out

        def _note_counts(ln: str) -> bool:
            nonlocal warn_count, error_count
            m = IqdCli._COUNT_SUMMARY_RE.search(ln)
            if not m:
                return False
            warn_count = int(m.group("warn"))
            error_count = int(m.group("err"))
            return True

        if (stdout and stdout.strip()) or (stderr and stderr.strip()):
            for blob in (stdout, stderr):
                if not blob or not blob.strip():
                    continue
                try:
                    data = json.loads(blob)
                except (ValueError, AttributeError, TypeError):
                    continue
                if isinstance(data, dict):
                    errors.extend(_as_msgs(data.get("errors")))
                    warnings.extend(_as_msgs(data.get("warnings")))
                    if not errors and not warnings:
                        errors.extend(_as_msgs(data.get("issues") or data.get("problems")))
                    msg = data.get("message") or data.get("error") or data.get("msg")
                    if isinstance(msg, str) and msg.strip() and not errors and not warnings:
                        if _note_counts(msg):
                            pass
                        elif "warn" in msg.lower() or "警告" in msg:
                            warnings.append(msg.strip())
                        else:
                            errors.append(msg.strip())
                    elif isinstance(msg, list):
                        for m in msg:
                            text = str(m).strip()
                            if text:
                                errors.append(text)
                    break

            if not errors and not warnings:
                text = f"{stdout}\n{stderr}"
                # Wren 真机格式：
                #   Warnings:
                #     ⚠ Model 'xxx' has no description ...
                #   3 warning(s), 0 errors.
                # 明细行往往不含 "warning" 字样，必须按分区收集。
                mode: str | None = None
                for raw_ln in text.splitlines():
                    stripped = raw_ln.strip()
                    if not stripped:
                        continue
                    if _note_counts(stripped):
                        mode = None
                        continue
                    low = stripped.lower()
                    if low in ("warnings:", "warning:") or low == "warnings":
                        mode = "warnings"
                        continue
                    if low in ("errors:", "error:") or low == "errors":
                        mode = "errors"
                        continue
                    item = re.sub(r"^[\s\-\*•·▪►▶⚠⚠️]+", "", stripped).strip()
                    if not item:
                        continue
                    if mode == "warnings":
                        warnings.append(item)
                    elif mode == "errors":
                        errors.append(item)
                    elif "warning" in low or "warn:" in low or "警告" in stripped:
                        warnings.append(item)
                    elif low.startswith("0 error") or low.startswith("0 fail"):
                        continue
                    elif (
                        "error:" in low
                        or low.startswith("error ")
                        or "失败" in stripped
                        or "错误" in stripped
                    ):
                        errors.append(item)

                if not warnings and not errors and warn_count is not None:
                    if (warn_count or 0) > 0 and (error_count or 0) == 0:
                        warnings.append(
                            f"检测到 {warn_count} 条警告，但 CLI 未输出明细。"
                            "请在 wren 机执行 `wren context validate` 查看逐条内容。"
                        )
                    elif (error_count or 0) > 0:
                        errors.append(
                            f"检测到 {error_count} 条错误（CLI 未输出明细）。"
                            "请在 wren 机执行 `wren context validate` 查看逐条内容。"
                        )
                elif not warnings and not errors:
                    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
                    if lines:
                        warnings.append(lines[0])

        def _uniq(items: list[str]) -> list[str]:
            seen: set[str] = set()
            out: list[str] = []
            for x in items:
                if x not in seen:
                    seen.add(x)
                    out.append(x)
            return out

        errors = _uniq(errors)
        warnings = _uniq(warnings)
        # 计数行本身勿进 errors（「0 errors」含 error 字样）
        errors = [e for e in errors if not IqdCli._COUNT_SUMMARY_RE.search(e)]
        warnings = [w for w in warnings if not IqdCli._COUNT_SUMMARY_RE.search(w)]
        # 上面过滤可能误伤「仅计数」占位——若清空且有 warn_count，补回提示
        if not warnings and not errors and warn_count is not None and (warn_count or 0) > 0:
            warnings.append(
                f"检测到 {warn_count} 条警告，但 CLI 未输出明细。"
                "请在 wren 机执行 `wren context validate` 查看逐条内容。"
            )

        if errors:
            summary = "; ".join(errors)
        elif warnings:
            summary = "; ".join(warnings)
        elif warn_count is not None:
            summary = f"{warn_count} warning(s), {error_count or 0} errors."
        else:
            summary = ""
        return {
            "summary": summary,
            "warnings": warnings,
            "errors": errors,
            "warn_count": warn_count,
            "error_count": error_count,
        }

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

    async def _run(
        self, args: list[str], *, cwd: str | None = None, allow_nonzero: bool = False
    ) -> dict[str, Any]:
        """执行 wren CLI 子命令。

        跨机器（``WREN_AGENT_ENDPOINT`` 非空）且给出 ``cwd``（``…/{connId}``）时，
        转发到 WrenMcpAgent ``POST /cli``，在 wren 机本机执行；否则走本机 subprocess。

        Args:
            args: 子命令参数（不含二进制本身）。
            cwd: 子进程工作目录（方案 A 多连接；不传则沿用进程 cwd）。
            allow_nonzero: ``True`` 时非零退出仍返回 stdout/stderr（不抛）；供 validate 等
                「警告也可能 exit!=0」的只读动作。

        Returns:
            含 ``command`` / ``exit_code`` / ``stdout`` / ``stderr`` 的字典。

        Raises:
            IqdCliError: 二进制不可执行；或非零退出且 ``allow_nonzero=False``。
        """
        # 跨机器：把 --mdl <local_dir> 抽成 manifest 正文，由 agent 落临时目录
        remote = await self._try_remote_run(args, cwd=cwd, allow_nonzero=allow_nonzero)
        if remote is not None:
            return remote

        command: list[str] = [self._bin, *args]
        # 本地路径：剥掉内部 --mdl 标记（新版 wren CLI 不接受该 option）
        run_args: list[str] = []
        skip_next = False
        for i, token in enumerate(args):
            if skip_next:
                skip_next = False
                continue
            if token == "--mdl":
                skip_next = True
                continue
            run_args.append(token)
        # 若只剩 context build 且本地已写过 target/mdl.json（mdl 被剥掉），仍执行 build
        command = [self._bin, *run_args]
        logger.info("wren CLI call", command=shlex.join(command), cwd=cwd)

        try:
            proc = await asyncio.create_subprocess_exec(
                *command,
                cwd=cwd,
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

        if proc.returncode != 0 and not allow_nonzero:
            raise IqdCliError(
                f"wren CLI 失败 exit={proc.returncode}: {shlex.join(command)}\n"
                f"stdout: {stdout[:2000]}\nstderr: {stderr[:2000]}"
            )

        logger.info("wren CLI done", exit_code=proc.returncode, stdout_len=len(stdout))
        return {
            "command": shlex.join(command),
            "exit_code": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
        }

    async def _try_remote_run(
        self, args: list[str], *, cwd: str | None, allow_nonzero: bool = False
    ) -> dict[str, Any] | None:
        """若启用 WrenMcpAgent 且 cwd 可解析为 connId，则远程执行；否则返回 None 走本地。"""
        import os

        from src.adapters.wren_mcp_agent_client import (
            WrenMcpAgentClient,
            WrenMcpAgentClientError,
        )

        agent = WrenMcpAgentClient()
        if not agent.enabled or not cwd:
            return None
        conn_id = os.path.basename(os.path.normpath(cwd))
        if not conn_id:
            return None

        clean_args: list[str] = []
        mdl_manifest: str | None = None
        skip_next = False
        for i, token in enumerate(args):
            if skip_next:
                skip_next = False
                continue
            if token == "--mdl" and i + 1 < len(args):
                mdl_path = args[i + 1]
                manifest_file = (
                    mdl_path
                    if mdl_path.endswith("manifest.json")
                    else os.path.join(mdl_path, "manifest.json")
                )
                try:
                    with open(manifest_file, encoding="utf-8") as fh:
                        mdl_manifest = fh.read()
                except OSError as exc:
                    raise IqdCliError(f"读取派生 MDL 失败: {manifest_file} -> {exc}") from exc
                skip_next = True
                continue
            clean_args.append(token)

        settings = get_settings()
        wait = float(settings.iqd_mcp.build_timeout_seconds or 120.0)
        logger.info(
            "wren CLI call (remote)",
            command=shlex.join(["wren", *clean_args]),
            conn_id=conn_id,
            has_mdl=bool(mdl_manifest),
            allow_nonzero=allow_nonzero,
        )
        try:
            data = await agent.run_cli(
                conn_id,
                clean_args,
                mdl_manifest=mdl_manifest,
                timeout=wait,
                raise_on_error=not allow_nonzero,
            )
        except WrenMcpAgentClientError as exc:
            raise IqdCliError(str(exc)) from exc
        return {
            "command": str(data.get("command") or shlex.join(["wren", *clean_args])),
            "exit_code": int(data.get("exit_code") or 0),
            "stdout": str(data.get("stdout") or ""),
            "stderr": str(data.get("stderr") or ""),
        }
