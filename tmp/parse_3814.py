import json

d = json.load(open(r"d:\code\mis-platform\tmp\trace-3814.json", encoding="utf-8"))["data"]
ps = d.get("plan_steps")
if isinstance(ps, str):
    ps = json.loads(ps)
out = {
    "id": d.get("id"),
    "question": d.get("question"),
    "latency_ms": d.get("latency_ms"),
    "error_code": d.get("error_code"),
    "error_message": d.get("error_message"),
    "summary": d.get("summary"),
    "sql_text": d.get("sql_text"),
    "steps": [
        {
            "code": s.get("code"),
            "status": s.get("status"),
            "ms": s.get("duration_ms"),
            "detail": s.get("detail"),
            "sql": s.get("sql"),
        }
        for s in (ps or [])
        if s.get("code")
        in ("searching", "generating", "lineage_check", "executing", "scope_check")
    ],
}
open(r"d:\code\mis-platform\tmp\trace-3814-brief.json", "w", encoding="utf-8").write(
    json.dumps(out, ensure_ascii=False, indent=2)
)
print("ok")
