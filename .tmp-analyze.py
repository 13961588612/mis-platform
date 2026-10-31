import json
from pathlib import Path

root = Path(r"D:\code\mis-platform")
out: list[str] = []
msgs = json.loads((root / ".tmp-msgs.json").read_text(encoding="utf-8-sig"))["data"]
out.append(f"msg_count={len(msgs)}")
for i, m in enumerate(msgs):
    role = m.get("role")
    c = m.get("content") or ""
    out.append(f"---[{i}] {role} len={len(c)}---")
    out.append(c[:2500])
    interesting = {
        k: m[k]
        for k in m
        if k != "content" and m.get(k) not in (None, "", [], {})
    }
    if interesting:
        out.append("EXTRA " + json.dumps(interesting, ensure_ascii=False)[:2000])

for name in [
    ".tmp-traces.json",
    ".tmp-rlogs.json",
    ".tmp-coord.json",
    ".tmp-spm.json",
    ".tmp-mcp.json",
    ".tmp-timing.json",
]:
    p = root / name
    out.append(f"\n==== {name} ====")
    try:
        d = json.loads(p.read_text(encoding="utf-8-sig"))
        out.append(json.dumps(d, ensure_ascii=False, indent=2)[:5000])
    except Exception as e:
        out.append(f"err {e}: {p.read_text(encoding='utf-8-sig', errors='replace')[:800]}")

sysj = json.loads((root / ".tmp-sys.json").read_text(encoding="utf-8-sig"))
content = ((sysj.get("data") or {}).get("content")) or ""
out.append("\n==== prompt checks ====")
out.append("has 超市有哪些门店: " + str("超市有哪些门店" in content))
out.append("has Skill 就绪后: " + str(("Skill 就绪后" in content) or ("Skill就绪后" in content)))
out.append("has 大统华: " + str("大统华" in content))
for line in content.splitlines():
    if "spm_report" in line or ("spm-report" in line and ("invoke" in line.lower() or "→" in line or "->" in line)):
        out.append("LINE: " + line)

(root / ".tmp-post-restart.txt").write_text("\n".join(out), encoding="utf-8")
print("ok", (root / ".tmp-post-restart.txt").stat().st_size)
