"""T11 E2E 集群契约测试包（多 Gateway + 多 Core 横向扩展）。

本包不存放可被误收集的非测试脚本；`run_fault_injection.py` 以 `run_` 前缀刻意避开
pytest 的 `test_*` 收集规则，仅作真实故障注入 harness（env-gate）。
"""
