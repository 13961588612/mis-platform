"""发布后引擎侧自检（2026-09-28）。

<背景>
``target/mdl.json`` 只是 ``wren context build`` 的产物；引擎（``wren context show`` 与
MCP）读的是 **YAML 工程**。平台发布流程此前只看 build 的退出码，于是
「发布成功、界面显示已同步，但引擎侧没有 cube / 没读到规则」可以静默存在一整轮
（真实事故：cube 与 relationship 缺失，直到人工跑 ``wren cube list`` 才发现）。

本模块在发布成功后读回 ``context show --output json``，与**派生 MDL**（本次发布的
预期）对账，把差异变成 ``SyncResult.warnings`` + ``report_sync_job`` 的告警，
从而在界面上可见。

设计原则：
- **只报不改**：自检绝不改动工程/数据，仅产出告警（避免自检本身成为新的破坏源）；
- **失败不阻断**：读回失败（CLI 不可用/超时）记一条 warning 即可，不改 build_status；
- **只比数量与关键名字**：引擎侧顺序不稳定、描述可回落，逐字段深比对会误报。
"""

from __future__ import annotations

from typing import Any

#: 数量不一致时这类差异最危险（对象直接消失），逐条列出名字便于定位
_LIST_KEYS: tuple[tuple[str, str], ...] = (
    ("models", "模型"),
    ("cubes", "cube"),
    ("relationships", "关系"),
)


class PublishSelfCheck:
    """把「派生 MDL」与「引擎侧 context show」对账，产出人可读告警。"""

    @staticmethod
    def compare(
        expected_mdl: dict[str, Any] | None,
        engine_context: dict[str, Any] | None,
    ) -> list[str]:
        """对账并返回告警列表（空列表 = 一致）。

        Args:
            expected_mdl: 本次发布的派生 MDL（``build_mdl_from_catalog`` 的产物）。
            engine_context: ``wren context show --output json`` 的解析结果。

        Returns:
            人可读告警（每条一句话，可挂到 ``SyncResult.warnings``）。
        """
        if not isinstance(expected_mdl, dict) or not isinstance(engine_context, dict):
            return []

        warnings: list[str] = []
        for key, label in _LIST_KEYS:
            expected_names = PublishSelfCheck._names(expected_mdl.get(key))
            engine_names = PublishSelfCheck._names(engine_context.get(key))

            missing = [n for n in expected_names if n not in engine_names]
            if missing:
                warnings.append(
                    f"自检：{len(missing)} 个{label}未进引擎上下文（{', '.join(missing[:5])}"
                    + ("…" if len(missing) > 5 else "")
                    + "）—— 发布可能只写了 target/mdl.json，未镜像进 YAML 工程"
                )
        return warnings

    @staticmethod
    async def probe_planner(cli: Any, mdl: dict[str, Any], *, limit: int = 20) -> list[str]:
        """对派生 MDL 里每个 model 跑一次只读 ``wren dry-plan``，把规划失败变成告警。

        <p><b>为什么</b>：wren 规划时会展开模型**全部计算列**；一个类型不合法的
        计算列（``double / varchar``）会让该模型所有查询在规划期失败，但
        ``context show`` 数量对账看不出来（模型/cube/关系都在）。本探针补上这一层：
        哪个模型规划不了，就在自检里点名（**只报不改**）。

        Args:
            cli: :class:`src.adapters.iqd_cli.IqdCli`（含 ``dry_plan``）——可注入替身。
            mdl: 本次发布的派生 MDL。
            limit: 最多探测的模型数（防御性上限，避免模型过多时自检过慢）。

        Returns:
            人可读告警列表（空 = 全部模型规划通过）。
        """
        if not isinstance(mdl, dict):
            return []
        models = [m for m in (mdl.get("models") or []) if isinstance(m, dict)]
        warnings: list[str] = []
        for model in models[:limit]:
            name = str(model.get("name") or "").strip()
            if not name:
                continue
            try:
                result = await cli.dry_plan(f"select * from {name} limit 1")
            except Exception as exc:  # noqa: BLE001 - 探针失败不算发布失败
                warnings.append(f"自检：模型 {name} 规划探针异常（{str(exc)[:80]}）")
                continue
            if not result.get("ok"):
                err = str(result.get("error") or "").strip().replace("\n", " ")
                warnings.append(
                    f"自检：模型 {name} 无法规划（{err[:160]}）——"
                    "常见原因：计算列类型不合法（如数值列除以字符串列），建议显式 CAST"
                )
        return warnings

    @staticmethod
    def _names(value: Any) -> list[str]:
        """取对象名清单（model 用 name；cube/measure/dimension 亦同）。"""
        if not isinstance(value, list):
            return []
        names: list[str] = []
        for item in value:
            if isinstance(item, dict):
                name = str(item.get("name") or "").strip()
            else:
                name = str(item).strip()
            if name:
                names.append(name)
        return names

    @staticmethod
    def summary(engine_context: dict[str, Any] | None) -> str:
        """把引擎侧上下文压成一行摘要（进日志/告警，便于快速判断）。"""
        if not isinstance(engine_context, dict):
            return "引擎上下文不可读"
        return "引擎侧：模型 {m} / cube {c} / 关系 {r}".format(
            m=len(PublishSelfCheck._names(engine_context.get("models"))),
            c=len(PublishSelfCheck._names(engine_context.get("cubes"))),
            r=len(PublishSelfCheck._names(engine_context.get("relationships"))),
        )
