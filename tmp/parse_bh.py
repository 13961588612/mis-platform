import json

d = json.load(open(r"d:\code\mis-platform\tmp\ask-bh-raw.json", encoding="utf-8"))
data = d.get("data") or {}
rd = data.get("data") or {}
lines = [
    f"status={data.get('status')}",
    f"answer={data.get('answerSummary')}",
    f"cols={[c.get('name') for c in (rd.get('columns') or [])]}",
    f"rows={json.dumps(rd.get('rows'), ensure_ascii=False)}",
]
for s in data.get("plan") or []:
    if s.get("code") in ("searching", "generating", "executing", "lineage_check"):
        lines.append(
            f"{s.get('code')} {s.get('status')} {s.get('duration_ms')}ms detail={s.get('detail')}"
        )
text = "\n".join(lines) + "\n"
open(r"d:\code\mis-platform\tmp\ask-bh-rows.txt", "w", encoding="utf-8").write(text)
print("ok")
