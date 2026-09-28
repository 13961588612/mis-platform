"""IqdCli — 本地 wren CLI 封装（v1.9 / B2 管理面）。

负责 MDL 构建/部署、profile 管理与**知识下发**（architecture §4.4②）：
- ``wren profile add <name>``      注册业务数据源连接（凭证由 profile 注入）
- ``wren context set-profile <name>`` 设定当前语义上下文所用 profile
- ``wren context build [--mdl <dir>]`` 构建/部署 MDL（建模同步 push）
- ``wren memory store --nl … --sql …`` 下发一条 NL→SQL 样本 → 写
  ``{project}/knowledge/sql/<slug>.md``（wren 侧 source of truth）并立即索引
- ``wren memory index`` 重建记忆索引；``knowledge/rules/*.md``（术语/口径/业务规则）
  由 :meth:`IqdCli.write_project_files` 落盘，供 ``wren context instructions`` 读取

知识落点与格式以 **wren 0.13.3 实测**为准（``wren memory --help`` / ``wren skills get
enrich-context``）：样本必须经 ``memory store`` 写、**不要手写** ``knowledge/sql/*.md``；
``knowledge/rules/`` 为自由 markdown（按主题一文件、``##`` 分组），且 **不被 memory index
嵌入** —— 它由 ``wren context instructions`` 直接读给 LLM。

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
        - ``sql_pairs`` / ``instructions``：**已废弃**（新 CLI 无 ``--sql-pairs`` /
          ``--instructions``）。知识下发改走 :meth:`IqdCli.memory_store`（样本 →
          ``knowledge/sql/*.md``）与 :meth:`IqdCli.write_project_files`（规则 →
          ``knowledge/rules/*.md``）；仍传这两个参数会被忽略并打 warning。

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
                "IQD context_build ignores sql_pairs（已改走 memory_store）",
                count=len(sql_pairs),
            )
        if instructions:
            logger.warning(
                "IQD context_build ignores instructions（已改走 write_project_files）",
                count=len(instructions),
            )

        args: list[str] = ["context", "build"]
        if force:
            args.extend(self._force_build_args)
        # 平台部署 MDL 的**内容哈希**（sha256[:16]）—— 取代此前的 `wqd-{时间}-{随机}` 回退值：
        # 那个值既不是内容相关、也与 wren 侧任何值不可比，导致 S3 漂移检测（比对
        # `built_mdl_hash` vs `get_current_mdl_hash`）形同虚设。现在两侧同算法、同字节：
        # 写侧 = 本地 manifest 文本；读侧 = 远端 `target/mdl.json` 文本（agent 原样落盘）。
        mdl_hash: str | None = None
        # YAML 镜像：随发布一并下发的 project 内文件（当前仅 relationships.yml）
        mirror_files: list[dict[str, str]] | None = None
        # --mdl 仅作内部标记：远程 _try_remote_run 抽出 manifest 交给 agent 写 target/mdl.json；
        # 本地则直接写入 project_dir/target/mdl.json，不再传给 wren CLI。
        if mdl_dir:
            import hashlib
            import os
            import shutil

            manifest_src = (
                mdl_dir
                if mdl_dir.endswith("manifest.json")
                else os.path.join(mdl_dir, "manifest.json")
            )
            try:
                with open(manifest_src, encoding="utf-8") as fh:
                    manifest_text = fh.read()
            except OSError as exc:
                raise IqdCliError(f"读取派生 MDL 失败: {manifest_src} -> {exc}") from exc
            mdl_hash = hashlib.sha256(manifest_text.encode("utf-8")).hexdigest()[:16]
            # 2026-09-28（YAML 镜像接线）：wren 0.13 的工程真源是 YAML
            # （``wren_project.yml`` / ``models/*/metadata.yml`` / ``relationships.yml``），
            # ``target/mdl.json`` 只是 build 产物。实测（连接 900001）：
            # 只落 target/mdl.json 时 ``wren context show`` 与 MCP（``get_mdl`` /
            # ``list_cubes`` / ``query_cube`` / ``get_context``）都读不到关系与 cube ——
            # 它们读的是 YAML 工程；而且任何一次 ``context build``（自愈/升级/手工）都会
            # 用 YAML 覆盖 target/mdl.json。故发布时把派生 MDL 的 relationships 一并
            # 镜像进 ``relationships.yml``（视图/cube 在 0.13 的 YAML 里无对应表达，见
            # ``wren context build --help``：views 必须带 statement，属 SQL 视图）。
            if project_dir:
                mirror_files = self._models_mirror_files(manifest_text)
                # cube ??????? views/??? SQL ?????? statement??
                # ?? wren ?? cube_proposals ??? ``cubes/<name>/metadata.yml``?
                # ????? 900001?2026-09-28????? ``context show`` cubes=1?
                # ``wren cube query --sql-only`` ??????????? context build?
                cube_files = self._cube_mirror_files(manifest_text)
                if cube_files:
                    mirror_files = (mirror_files or []) + cube_files
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
        result = await self._run(args, cwd=project_dir)
        if mirror_files and project_dir:
            # 单独一次文件下发：agent 在「只部署 manifest」时会短路返回
            # （``command=deploy target/mdl.json``，**不带** ``written`` 回执），
            # 与 ``files`` 同请求会让平台的 fail-loud 校验误判「agent 未升级」。
            # 走既有的 project files 通道（args 为空）能拿到 ``written`` 回执。
            mirror_result = await self.write_project_files(
                mirror_files, project_dir=project_dir
            )
            result["mirror_written"] = mirror_result.get("written") or []
        if mdl_hash:
            result["mdl_hash"] = mdl_hash
        return result
    @staticmethod
    def _relationships_mirror_files(manifest_text: str) -> list[dict[str, str]] | None:
        """把派生 MDL 的 ``relationships`` 转成 wren 工程的 ``relationships.yml``（YAML 镜像）。

        <p>形状以 wren 0.13 实测为准（``wren context init --from-mdl`` 产物 + 引擎校验
        报错“relationships.yml must be a mapping with a 'relationships' key”）：

        .. code-block:: yaml

            relationships:
            - name: sale_ord_store
              models:
              - ads_spm_trd_sale_category_day_df
              - dwd_spm_trd_sale_ord_detl_df
              join_type: INNER
              condition: a.store_id = b.store_id

        <p>只镜像引擎真正消费的字段（``name`` / ``models`` / ``join_type`` /
        ``condition``）；平台内信封字段 ``expression`` 属元数据，不写入 YAML，避免
        触发未知字段校验。无关系时写 ``relationships: []`` 以清掉陈旧镜像。

        Args:
            manifest_text: 派生 MDL（manifest.json）全文。

        Returns:
            ``[{"path": "relationships.yml", "content": ...}]``；manifest 解析失败或
            PyYAML 不可用时返回 ``None``（降级为「仅落 target/mdl.json」，不阻断发布）。
        """
        try:
            mdl: Any = json.loads(manifest_text)
        except (ValueError, TypeError):
            return None
        raw_rels = mdl.get("relationships") if isinstance(mdl, dict) else None
        if not isinstance(raw_rels, list):
            return None

        items: list[dict[str, Any]] = []
        for rel in raw_rels:
            if not isinstance(rel, dict):
                continue
            name = str(rel.get("name") or "").strip()
            models = [
                str(m).strip() for m in (rel.get("models") or []) if str(m).strip()
            ]
            condition = str(rel.get("condition") or "").strip()
            if not name or len(models) < 2 or not condition:
                # 关系必须能定位两侧模型与连接条件，否则引擎侧只会报错
                continue
            item: dict[str, Any] = {
                "name": name,
                "models": models,
                "condition": condition,
            }
            join_type = IqdCli._relationship_join_type(rel)
            if join_type:
                item["join_type"] = join_type
            items.append(item)
        try:
            import yaml
        except ImportError:  # pragma: no cover - 依赖缺失时降级
            logger.warning("PyYAML 不可用，跳过 relationships.yml 镜像")
            return None
        content = yaml.safe_dump(
            {"relationships": items},
            allow_unicode=True,
            sort_keys=False,
            default_flow_style=False,
        )
        return [{"path": "relationships.yml", "content": content}]

    #: ?? catalog ?????? MDL ?????? cube ??/?? YAML ? type?
    #: ???? type ????? SQL ???``VARCHAR(65533)`` ??????????? ``VARCHAR``?
    _CUBE_TYPE_MAP: dict[str, str] = {
        "INT": "BIGINT",
        "INTEGER": "BIGINT",
        "BIGINT": "BIGINT",
        "SMALLINT": "BIGINT",
        "TINYINT": "BIGINT",
        "DOUBLE": "DOUBLE",
        "FLOAT": "DOUBLE",
        "REAL": "DOUBLE",
        "NUMERIC": "DOUBLE",
        "DECIMAL": "DOUBLE",
        "BOOLEAN": "BOOLEAN",
        "BOOL": "BOOLEAN",
        "DATE": "DATE",
        "TIMESTAMP": "TIMESTAMP",
        "DATETIME": "TIMESTAMP",
        "VARCHAR": "VARCHAR",
        "STRING": "VARCHAR",
        "TEXT": "VARCHAR",
        "CHAR": "VARCHAR",
    }

    @classmethod
    def _cube_type(cls, raw: Any, *, measure: bool) -> str:
        """? MDL/catalog ??????? cube YAML ??? ``type``?

        <p>???``cubes/<name>/metadata.yml`` ??? measure/dimension ?? ``type``?
        ??? SQL ????????? ``DOUBLE``??????????? ``VARCHAR``?
        """
        token = str(raw or "").strip().upper()
        if token:
            base = token.split("(", 1)[0].strip()
            mapped = cls._CUBE_TYPE_MAP.get(base)
            if mapped:
                if measure and mapped in ("BIGINT", "DOUBLE"):
                    return mapped
                return mapped if mapped != "BIGINT" else ("BIGINT" if measure else "VARCHAR")
        return "DOUBLE" if measure else "VARCHAR"

    @staticmethod
    def _cube_mirror_files(manifest_text: str) -> list[dict[str, str]]:
        """??? MDL ? ``cubes`` ?????? ``cubes/<name>/metadata.yml``?

        <p><b>????? views/</b>?wren 0.13 ? ``views/<name>/metadata.yml`` ? SQL ??
        ???? ``statement``???? ``view missing 'statement'``???
        measures/dimensions ????? cube?cube ??????
        ``cubes/<name>/metadata.yml``?``wren skills get enrich-context --full`` ?
        ``cube_proposals`` ?????**??**??? YAML ????``wren context show`` /
        MCP?``list_cubes`` / ``query_cube`` / ``get_context``????? ?? ?? cube
        ???? ``target/mdl.json``??? ``context build`` ????

        <p>????? MDL ? ``base_object`` ????????????? measure/dimension
        ??? DOUBLE/VARCHAR??????????????``name`` / ``expression`` / ``type``??

        Args:
            manifest_text: ?? MDL?manifest.json????

        Returns:
            ``[{"path": "cubes/<name>/metadata.yml", "content": ...}]``?? cube ?
            PyYAML ?????? ``[]``???????????
        """
        try:
            mdl: Any = json.loads(manifest_text)
        except (ValueError, TypeError):
            return []
        raw_cubes = mdl.get("cubes") if isinstance(mdl, dict) else None
        if not isinstance(raw_cubes, list) or not raw_cubes:
            return []
        try:
            import yaml
        except ImportError:  # pragma: no cover - ???????
            logger.warning("PyYAML ?????? cubes/* ??")
            return []

        # base_object ? {????: ??}
        col_types: dict[str, dict[str, str]] = {}
        for model in mdl.get("models") or []:
            if not isinstance(model, dict):
                continue
            name = str(model.get("name") or "").strip()
            if not name:
                continue
            col_types[name] = {
                str(c.get("name") or "").strip().lower(): str(c.get("type") or "")
                for c in (model.get("columns") or [])
                if isinstance(c, dict)
            }

        files: list[dict[str, str]] = []
        for cube in raw_cubes:
            if not isinstance(cube, dict):
                continue
            name = str(cube.get("name") or "").strip()
            base = str(cube.get("baseObject") or cube.get("base_object") or "").strip()
            if not name or not base:
                continue
            known = col_types.get(base, {})
            payload: dict[str, Any] = {"name": name, "base_object": base}

            def _column_specs(key: str, *, measure: bool) -> list[dict[str, Any]]:
                out: list[dict[str, Any]] = []
                for item in cube.get(key) or []:
                    if not isinstance(item, dict):
                        continue
                    cname = str(item.get("name") or "").strip()
                    expr = str(item.get("expression") or "").strip()
                    if not cname or not expr:
                        continue
                    raw_type = item.get("type") or known.get(expr.strip().lower())
                    out.append(
                        {
                            "name": cname,
                            "expression": expr,
                            "type": IqdCli._cube_type(raw_type, measure=measure),
                        }
                    )
                return out

            measures = _column_specs("measures", measure=True)
            dimensions = _column_specs("dimensions", measure=False)
            if measures:
                payload["measures"] = measures
            if dimensions:
                payload["dimensions"] = dimensions
            time_dims = _column_specs("timeDimensions", measure=False) or _column_specs(
                "time_dimensions", measure=False
            )
            if time_dims:
                payload["time_dimensions"] = time_dims
            description = str(
                cube.get("description")
                or (cube.get("properties") or {}).get("description")
                or ""
            ).strip()
            if description:
                payload["properties"] = {"description": description}

            files.append(
                {
                    "path": f"cubes/{name}/metadata.yml",
                    "content": yaml.safe_dump(
                        payload,
                        allow_unicode=True,
                        sort_keys=False,
                        default_flow_style=False,
                    ),
                }
            )
        return files

    #: ?????????``1:N`` ??? wren ?? ``join_type`` ???
    _CARDINALITY_TO_JOIN_TYPE: dict[str, str] = {
        "1:1": "ONE_TO_ONE",
        "1:N": "ONE_TO_MANY",
        "N:1": "MANY_TO_ONE",
        "M:N": "MANY_TO_MANY",
        "N:N": "MANY_TO_MANY",
    }

    @staticmethod
    def _relationship_join_type(rel: dict[str, Any]) -> str | None:
        """? wren ????? ``join_type``?**????**???????? ``None``?

        <p>????? ``expression`` ???? ``cardinality``???
        ``_parse_relationship_payload`` ?????????? relationship ??
        ``cardinality`` / ``joinType`` ????????``ONE_TO_MANY``?? ``1:N`` ???
        ? ?? ``None`` ?? **?????**???? SQL ? ``INNER`` ??????
        ?????? ``unknown variant `INNER`, expected one of ONE_TO_ONE/ONE_TO_MANY/
        MANY_TO_ONE/MANY_TO_MANY``????? ``wren cube query`` ??????
        ?``context validate`` ??????
        """
        valid = set(IqdCli._CARDINALITY_TO_JOIN_TYPE.values())
        candidates: list[str] = []
        envelope = rel.get("expression")
        if isinstance(envelope, str) and envelope.strip().startswith("{"):
            try:
                parsed: Any = json.loads(envelope)
            except (ValueError, TypeError):
                parsed = None
            if isinstance(parsed, dict):
                for key in ("cardinality", "cardinalityType", "cardinality_type"):
                    if parsed.get(key):
                        candidates.append(str(parsed[key]))
        for key in ("cardinality", "joinType", "join_type"):
            if rel.get(key):
                candidates.append(str(rel[key]))
        for raw in candidates:
            token = raw.strip()
            if not token:
                continue
            upper = token.upper().replace(":", "_TO_")
            if upper in valid:
                return upper
            mapped = IqdCli._CARDINALITY_TO_JOIN_TYPE.get(token.upper().replace(" ", ""))
            if mapped:
                return mapped
        return None

    @staticmethod
    def _models_mirror_files(manifest_text: str) -> list[dict[str, str]]:
        """??? MDL ? models ?????? models/<name>/metadata.yml?

        target/mdl.json ?? build ????????MCP get_mdl/get_context??
        wren context show ??? YAML ??????900001???????????
        target/mdl.json?YAML ?? -> ??????????? context build ????
        ??"???? type"?????????? type ???????
        """
        try:
            mdl: Any = json.loads(manifest_text)
        except (ValueError, TypeError):
            return []
        raw_models = mdl.get("models") if isinstance(mdl, dict) else None
        if not isinstance(raw_models, list):
            return []
        try:
            import yaml
        except ImportError:
            logger.warning("PyYAML unavailable, skip models/* mirror")
            return []
        known_types: dict[str, str] = {}
        for model in raw_models:
            if not isinstance(model, dict):
                continue
            for col in model.get("columns") or []:
                if isinstance(col, dict) and col.get("name") and col.get("type"):
                    known_types[str(col["name"]).strip().lower()] = str(col["type"])
        files: list[dict[str, str]] = []
        for model in raw_models:
            if not isinstance(model, dict):
                continue
            name = str(model.get("name") or "").strip()
            if not name:
                continue
            ref = model.get("tableReference") or {}
            pk = [str(x).strip() for x in (model.get("primaryKey") or []) if str(x).strip()]
            props = model.get("properties") if isinstance(model.get("properties"), dict) else {}
            # MDL ??????????? description?context show ??????
            # properties.description ???????? description????????
            if not (props or {}).get("description"):
                top_desc = model.get("description")
                if top_desc:
                    props = {**(props or {}), "description": str(top_desc)}
            columns: list[dict[str, Any]] = []
            for col in model.get("columns") or []:
                if not isinstance(col, dict):
                    continue
                cname = str(col.get("name") or "").strip()
                if not cname:
                    continue
                entry: dict[str, Any] = {"name": cname}
                etype = str(col.get("type") or col.get("dataType") or "").strip()
                is_calc = bool((col.get("isCalculated") or col.get("is_calculated")) or ("expression" in col))
                if is_calc and not etype:
                    # ?????? MDL ??? type????? name+expression??
                    # ??????? type??? wren context validate ?
                    # "column missing 'type'"???????????? DOUBLE?
                    expr = str(col.get("expression") or "")
                    if expr:
                        etype = IqdCli._infer_calc_column_type(expr, known_types)
                    if not etype:
                        etype = "DOUBLE"
                if etype:
                    entry["type"] = etype
                if not etype:
                    # ??????????????? type???????
                    # "column missing 'type'"??? 900001 ? 189 ???
                    # ? MDL/catalog ??????? VARCHAR?
                    etype = IqdCli._infer_calc_column_type(cname, known_types) or "VARCHAR"
                    entry["type"] = etype
                if is_calc:
                    entry["is_calculated"] = True
                if col.get("expression"):
                    entry["expression"] = str(col["expression"])
                if col.get("notNull"):
                    entry["not_null"] = True
                if col.get("isPrimaryKey"):
                    entry["is_primary_key"] = True
                col_desc = col.get("description") or (col.get("properties") or {}).get("description")
                if col_desc:
                    entry["properties"] = {"description": str(col_desc)}
                columns.append(entry)
            if not columns:
                continue
            payload: dict[str, Any] = {"name": name}
            if ref:
                payload["table_reference"] = ref
            payload["columns"] = columns
            if pk:
                payload["primary_key"] = pk
            payload["cached"] = bool(model.get("cached"))
            payload["properties"] = props or {}
            files.append(
                {
                    "path": f"models/{name}/metadata.yml",
                    "content": yaml.safe_dump(
                        payload,
                        allow_unicode=True,
                        sort_keys=False,
                        default_flow_style=False,
                    ),
                }
            )
        return files

    @staticmethod
    def _infer_calc_column_type(expression: str, known_types: dict[str, str]) -> str:
        """????????? ``type``????????? type ?? validate ????

        <p>??????????????????????``kds / cust_cnt`` ? ``kds``??
        ?????????????? ``DOUBLE``???? YAML ??????? catalog
        ?? ??? ``data_type`` ????? 3 ????
        """
        import re as _re

        for token in _re.findall(r"[A-Za-z_][A-Za-z0-9_]*", expression or ""):
            key = token.strip().lower()
            if key in known_types:
                base = known_types[key].split("(", 1)[0].strip().upper()
                if base in ("DOUBLE", "FLOAT", "REAL", "DECIMAL", "NUMERIC"):
                    return "DOUBLE"
                if base in ("BIGINT", "INT", "INTEGER", "SMALLINT", "TINYINT"):
                    return "BIGINT"
                if base in ("TIMESTAMP", "DATETIME"):
                    return "TIMESTAMP"
                if base == "DATE":
                    return "DATE"
                if base in ("BOOLEAN", "BOOL"):
                    return "BOOLEAN"
                return "VARCHAR"
        return "DOUBLE"
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

    # ================================================================ 知识下发（方案 A：文件即真相）

    async def memory_check(self, *, project_dir: str | None = None) -> dict[str, Any]:
        """对账 wren 侧 ``knowledge/sql/*.md``（源）与派生索引（``wren memory check``）。

        <p>只读自证：回收文件后用它确认索引不再残留孤儿行（wren 会打印
        ``N user pair(s) indexed without markdown — stale index``）。非零退出也返回
        stdout/stderr，由调用方判定漂移，不在此抛错。

        Args:
            project_dir: 目标 wren project 目录（方案 A 多连接）。

        Returns:
            CLI 结果字典（``stdout`` 含 ``knowledge/sql: N pair(s); index: M pair(s)``）。
        """
        return await self._run(["memory", "check"], cwd=project_dir, allow_nonzero=True)

    @staticmethod
    def _safe_rel_path(path: str) -> str:
        """校验并归一 project 内相对路径（绝对路径 / ``..`` 越界即拒）。"""
        raw = (path or "").replace("\\", "/").strip()
        if raw.startswith("/") or re.match(r"^[A-Za-z]:", raw):
            raise IqdCliError(f"非法 project 相对路径（不允许绝对路径）: {path!r}")
        normalized = raw.strip("/")
        if not normalized or any(seg in ("", ".", "..") for seg in normalized.split("/")):
            raise IqdCliError(f"非法 project 相对路径: {path!r}")
        return normalized

    def _write_files_local(self, project_dir: str, files: list[dict[str, str]]) -> list[str]:
        """本地（同机）把文本文件写入 project，返回已写相对路径。"""
        import os

        written: list[str] = []
        for item in files:
            rel = self._safe_rel_path(str(item.get("path") or ""))
            dest = os.path.join(project_dir, *rel.split("/"))
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            try:
                with open(dest, "w", encoding="utf-8") as fh:
                    fh.write(str(item.get("content") or ""))
            except OSError as exc:
                raise IqdCliError(f"写入 {rel} 失败: {exc}") from exc
            written.append(rel)
        logger.info("wren project files written", project_dir=project_dir, files=written)
        return written

    def _delete_files_local(self, project_dir: str, paths: list[str]) -> list[str]:
        """本地删除 project 内文件（只删文件；不存在视为已删）。"""
        import os

        deleted: list[str] = []
        for raw in paths:
            rel = self._safe_rel_path(str(raw))
            dest = os.path.join(project_dir, *rel.split("/"))
            if os.path.isdir(dest):
                raise IqdCliError(f"拒绝删除目录: {rel}")
            if os.path.isfile(dest):
                try:
                    os.remove(dest)
                except OSError as exc:
                    raise IqdCliError(f"删除 {rel} 失败: {exc}") from exc
            deleted.append(rel)
        logger.info("wren project files deleted", project_dir=project_dir, files=deleted)
        return deleted

    def _list_files_local(
        self, project_dir: str, rel_dir: str, prefix: str | None = None
    ) -> list[dict[str, str]]:
        """本地列出某目录下文件（相对路径 + 正文），供上游做状态对账。"""
        import os

        rel = self._safe_rel_path(rel_dir)
        root = os.path.join(project_dir, *rel.split("/"))
        if not os.path.isdir(root):
            return []
        out: list[dict[str, str]] = []
        for name in sorted(os.listdir(root)):
            if prefix and not name.startswith(prefix):
                continue
            full = os.path.join(root, name)
            if not os.path.isfile(full):
                continue
            try:
                with open(full, encoding="utf-8") as fh:
                    content = fh.read()
            except OSError as exc:
                raise IqdCliError(f"读取 {rel}/{name} 失败: {exc}") from exc
            out.append({"path": f"{rel}/{name}", "content": content})
        return out

    async def delete_project_files(
        self, paths: list[str], *, project_dir: str | None = None
    ) -> dict[str, Any]:
        """删除 wren project 内文件（平台回收自己下发的内容；跨机器经 agent）。

        Args:
            paths: project 内相对文件路径列表（越界即拒；目录拒绝）。
            project_dir: 目标 wren project 目录。

        Returns:
            文件操作结果字典（``deleted`` 为已删相对路径）。
        """
        if not project_dir:
            raise IqdCliError("delete_project_files 需要 project_dir")
        normalized = [self._safe_rel_path(str(p)) for p in paths]
        if not normalized:
            return {"command": "project files op", "exit_code": 0, "deleted": []}
        return await self._run([], cwd=project_dir, delete_paths=normalized)

    async def list_project_files(
        self,
        rel_dir: str,
        *,
        prefix: str | None = None,
        project_dir: str | None = None,
    ) -> list[dict[str, str]]:
        """列出 wren project 内某目录下的文件（相对路径 + 正文；跨机器经 agent）。

        用于**下发对账**：平台据此判断 wren 侧哪些文件是自己下发的、是否已过期
        （见 :meth:`IqdAskService._prune_stale_sample_files`）。
        """
        if not project_dir:
            raise IqdCliError("list_project_files 需要 project_dir")
        result = await self._run(
            [], cwd=project_dir, list_path=rel_dir, list_prefix=prefix
        )
        listed = result.get("listed")
        return list(listed) if isinstance(listed, list) else []

    async def write_project_files(
        self, files: list[dict[str, str]], *, project_dir: str | None = None
    ) -> dict[str, Any]:
        """把平台生成的文本文件写入 wren project（``knowledge/rules/*.md`` 等）。

        <p><b>为什么需要它</b>：wren 0.13.3 只有 ``knowledge/sql/`` 有 CLI 写入口
        （``memory store``）；``knowledge/rules/`` 只能落文件。跨机器时平台无法直写 wren 机
        磁盘，故经 WrenMcpAgent ``/cli`` 的 ``files`` 字段由 agent 落盘（同机则本地写）。

        Args:
            files: ``[{"path": "knowledge/rules/mis-iqd-platform.md", "content": "..."}]``；
                ``path`` 必须是 project 内相对路径（越界即拒）。
            project_dir: 目标 wren project 目录。

        Returns:
            CLI/写盘结果字典（``exit_code`` / ``stdout`` / ``written``）。

        Raises:
            IqdCliError: 缺少 project_dir、路径非法或写盘失败。
        """
        if not project_dir:
            raise IqdCliError("write_project_files 需要 project_dir")
        normalized = [
            {
                "path": self._safe_rel_path(str(item.get("path") or "")),
                "content": str(item.get("content") or ""),
            }
            for item in files
        ]
        if not normalized:
            return {"command": "write project files", "exit_code": 0, "stdout": "", "stderr": ""}
        result = await self._run([], cwd=project_dir, files=normalized)
        result["written"] = [item["path"] for item in normalized]
        return result

    async def memory_store(
        self,
        *,
        nl: str,
        sql: str,
        tags: str | None = None,
        project_dir: str | None = None,
    ) -> dict[str, Any]:
        """下发一条 NL→SQL 样本：``wren memory store``。

        <p>wren 侧效果（0.13.3 实测）：写 ``knowledge/sql/<slug>.md``（frontmatter 含
        ``nl`` / ``sql`` / ``source`` / 可选 ``tags``）+ 立即更新派生索引；官方明确**不要手写**
        这些文件。跨机器时纯 args 即可（无需传文件）。

        Args:
            nl: 自然语言问题（平台 ``iqd_sql_pair.question``）。
            sql: WrenAI 方言 SQL（平台 ``wren_sql``）。
            tags: 可选标签（逗号分隔），便于回溯来源（如 ``source:mis-iqd``）。
            project_dir: 目标 wren project 目录。

        Returns:
            CLI 结果字典。

        Raises:
            IqdCliError: 缺 nl/sql、CLI 不可用或非零退出。
        """
        if not (nl or "").strip() or not (sql or "").strip():
            raise IqdCliError("memory store 需要 nl 与 sql（均不可为空）")
        args = ["memory", "store", "--nl", str(nl), "--sql", str(sql)]
        if tags:
            args.extend(["--tags", str(tags)])
        return await self._run(args, cwd=project_dir)

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

        <p><b>口径（2026-09-28 改）</b>：平台部署 MDL 时把 ``target/mdl.json`` 的
        **内容哈希** ``sha256[:16]`` 作为 ``mdl_hash``（见 :meth:`context_build`）。
        本方法优先用**同一算法**对 wren 机上现存的 ``target/mdl.json`` 现算，两边天然可比 ——
        此前回退造的 ``wqd-{时间}-{随机}`` 与 wren 侧任何值都不可比，漂移检测形同虚设。

        取不到文件时回退旧路径（``wren get mdl`` 解析），仍失败则**返回 ``None``**
        （不抛，调用方据此「不判定漂移」）。

        Args:
            project_dir: 目标 wren project 目录（方案 A 多连接）；缺省沿用 cwd。

        Returns:
            当前 mdl_hash 字符串；不可达或解析失败返回 ``None``。

        Note:
            调用方（漂移检测）需将 ``None`` 视为「无法判定」并跳过漂移标记，避免误伤。
        """
        if project_dir:
            try:
                import hashlib

                files = await self.list_project_files("target", project_dir=project_dir)
                for item in files:
                    if str(item.get("path") or "").endswith("mdl.json"):
                        text = str(item.get("content") or "")
                        return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
            except Exception as exc:  # noqa: BLE001 - 取不到就走旧路径（降级不抛）
                logger.warning("IQD current mdl_hash from target/mdl.json failed", error=str(exc))
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
        self,
        args: list[str],
        *,
        cwd: str | None = None,
        allow_nonzero: bool = False,
        files: list[dict[str, str]] | None = None,
        delete_paths: list[str] | None = None,
        list_path: str | None = None,
        list_prefix: str | None = None,
    ) -> dict[str, Any]:
        """执行 wren CLI 子命令。

        跨机器（``WREN_AGENT_ENDPOINT`` 非空）且给出 ``cwd``（``…/{connId}``）时，
        转发到 WrenMcpAgent ``POST /cli``，在 wren 机本机执行；否则走本机 subprocess。

        Args:
            args: 子命令参数（不含二进制本身）。
            cwd: 子进程工作目录（方案 A 多连接；不传则沿用进程 cwd）。
            allow_nonzero: ``True`` 时非零退出仍返回 stdout/stderr（不抛）；供 validate 等
                「警告也可能 exit!=0」的只读动作。
            files: 可选 project 内文本文件（跨机器交由 agent 落盘；同机直接写）；``args``
                为空时只写文件、不跑 CLI。
            delete_paths: 可选要删除的 project 内相对文件（``args`` 为空时只做文件操作）。
            list_path / list_prefix: 可选列出目录下文件（含正文），供上游做状态对账。

        Returns:
            含 ``command`` / ``exit_code`` / ``stdout`` / ``stderr`` 的字典。

        Raises:
            IqdCliError: 二进制不可执行；或非零退出且 ``allow_nonzero=False``。
        """
        # 跨机器：把 --mdl <local_dir> 抽成 manifest 正文，由 agent 落临时目录
        remote = await self._try_remote_run(
            args,
            cwd=cwd,
            allow_nonzero=allow_nonzero,
            files=files,
            delete_paths=delete_paths,
            list_path=list_path,
            list_prefix=list_prefix,
        )
        if remote is not None:
            return remote

        # 本地路径：先把平台下发的文本文件写入 project（越界路径由 _safe_rel_path 拦下）
        written: list[str] = []
        if files:
            if not cwd:
                raise IqdCliError("下发 project 文件需要 cwd(project_dir)")
            written = self._write_files_local(cwd, files)
        deleted: list[str] = []
        if delete_paths:
            if not cwd:
                raise IqdCliError("删除 project 文件需要 cwd(project_dir)")
            deleted = self._delete_files_local(cwd, delete_paths)
        listed: list[dict[str, str]] = []
        if list_path:
            if not cwd:
                raise IqdCliError("列出 project 文件需要 cwd(project_dir)")
            listed = self._list_files_local(cwd, list_path, list_prefix)
        if not args:
            return {
                "command": "project files op",
                "exit_code": 0,
                "stdout": (
                    f"wrote {len(written)}, deleted {len(deleted)}, listed {len(listed)}\n"
                ),
                "stderr": "",
                "written": written,
                "deleted": deleted,
                "listed": listed,
            }

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
        self,
        args: list[str],
        *,
        cwd: str | None,
        allow_nonzero: bool = False,
        files: list[dict[str, str]] | None = None,
        delete_paths: list[str] | None = None,
        list_path: str | None = None,
        list_prefix: str | None = None,
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
            file_count=len(files or []),
            has_file_ops=bool(files or delete_paths or list_path),
            allow_nonzero=allow_nonzero,
        )
        try:
            data = await agent.run_cli(
                conn_id,
                clean_args,
                mdl_manifest=mdl_manifest,
                files=files,
                delete_paths=delete_paths,
                list_path=list_path,
                list_prefix=list_prefix,
                timeout=wait,
                raise_on_error=not allow_nonzero,
            )
        except WrenMcpAgentClientError as exc:
            raise IqdCliError(str(exc)) from exc
        # fail-loud：**旧版 agent 会静默忽略** files / delete_paths / list_path（Pydantic 丢弃
        # 未知字段），于是「规则下发成功」「回收成功」全是假的。缺对应回执即视为未升级。
        if files and "written" not in data:
            raise IqdCliError(
                "WrenMcpAgent 未升级：不支持 files（knowledge/rules 下发需要新版 agent）"
            )
        if delete_paths and "deleted" not in data:
            raise IqdCliError(
                "WrenMcpAgent 未升级：不支持 delete_paths（样本回收需要新版 agent）"
            )
        if list_path and "listed" not in data:
            raise IqdCliError(
                "WrenMcpAgent 未升级：不支持 list_path（下发对账需要新版 agent）"
            )
        return {
            "command": str(data.get("command") or shlex.join(["wren", *clean_args])),
            "exit_code": int(data.get("exit_code") or 0),
            "stdout": str(data.get("stdout") or ""),
            "stderr": str(data.get("stderr") or ""),
            "written": list(data.get("written") or []),
            "deleted": list(data.get("deleted") or []),
            "listed": list(data.get("listed") or []),
        }
