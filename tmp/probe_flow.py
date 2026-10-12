import json, re, urllib.request, urllib.error

BASE = "http://127.0.0.1:8080"


def req(method, path, body=None, token=None, params=None):
    url = BASE + path
    if params:
        url += "?" + "&".join(f"{k}={v}" for k, v in params.items())
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(r, timeout=20) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        return {"httpError": e.code, "body": e.read().decode()[:400]}
    except Exception as e:
        return {"err": str(e)}


# 1) captcha
cap = req("GET", "/api/v1/auth/captcha", params={"appCode": "system"})
svg = (cap.get("data") or {}).get("imageBase64") or ""
import base64
svg = re.sub(r"^data:image/\w+\+?xml;base64,", "", svg)
try:
    svg = base64.b64decode(svg).decode("utf-8", errors="replace")
except Exception:
    pass
# 每个字符一个 <text>…</text>，按 x 坐标排序拼回验证码
chars = []
for tag in re.findall(r"<text\b[^>]*>(.*?)</text>", svg, re.S):
    for c in re.findall(r">([^<>]+)<", "<text>" + tag + "</text>"):
        c = c.strip()
        if c:
            chars.append(c)
code = "".join(chars)[:4]
print("captcha code =", repr(code), "| raw svg head =", svg[:40])

# 2) login
login = req("POST", "/api/v1/auth/login", {
    "appCode": "system", "username": "admin", "password": "Mis@123456",
    "captchaId": (cap.get("data") or {}).get("captchaId"), "captchaCode": code,
})
tok = (login.get("data") or {}).get("accessToken")
print("login code =", login.get("code"), "msg =", login.get("message"), "token? ", bool(tok))
if not tok:
    print(json.dumps(login, ensure_ascii=False)[:500])
    raise SystemExit(1)

# 3) list definitions
lst = req("GET", "/api/v1/workflow/definitions", token=tok,
          params={"tenantId": "1", "page": "1", "size": "50"})
print("\n=== definitions list ===")
print("code =", lst.get("code"), "| httpError =", lst.get("httpError"), "| err =", lst.get("err"))
data = lst.get("data") or {}
rows = data.get("records") or data.get("list") or data if isinstance(data, list) else []
if isinstance(data, dict):
    rows = data.get("records") or data.get("list") or []
print("count =", len(rows))
for r in rows:
    print("  id=%s code=%s name=%s status=%s" % (
        r.get("id"), r.get("code"), r.get("name"), r.get("status")))

target = None
for r in rows:
    if str(r.get("code")) == "sample_flow" or "实例" in str(r.get("name")):
        target = r
        break
if target is None and rows:
    target = rows[0]
print("\ntarget definition =", json.dumps(target, ensure_ascii=False)[:300] if target else None)

# 4) detail of target
if target:
    did = target.get("id")
    det = req("GET", f"/api/v1/workflow/definitions/{did}", token=tok, params={"tenantId": "1"})
    print("\n=== definition detail id=%s ===" % did)
    print("code =", det.get("code"), "| msg =", det.get("message"),
          "| httpError =", det.get("httpError"), "| err =", det.get("err"))
    dd = det.get("data") or {}
    if isinstance(dd, dict):
        print("keys =", sorted(dd.keys()))
        nodes = dd.get("nodes")
        edges = dd.get("edges")
        print("nodes =", None if nodes is None else len(nodes))
        print("edges =", None if edges is None else len(edges))
        if edges:
            print("edge sample =", json.dumps(edges[:5], ensure_ascii=False))
        if nodes:
            codes = [n.get("nodeCode") for n in nodes]
            print("nodeCodes =", codes)
            if edges:
                es = set()
                for e in edges:
                    es.add((e.get("source"), e.get("target")))
                missing = [x for x in es if x[0] not in codes or x[1] not in codes]
                print("edges referencing unknown nodeCode =", missing)
    else:
        print(json.dumps(det, ensure_ascii=False)[:600])
