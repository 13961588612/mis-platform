#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Isolate SSE 500 cause: try /api/v1/events/stream with various query params."""
import json, base64, urllib.request, urllib.error, re


import os, sys

TOKEN_FILE = os.path.join(os.environ.get("TEMP", "/tmp"), "a2ui_token.txt")
if len(sys.argv) > 1 and sys.argv[1] == "--fresh":
    def cap():
        b = json.loads(urllib.request.urlopen(
            urllib.request.Request("http://localhost:8080/api/v1/auth/captcha"),
            timeout=10).read().decode())
        d = b["data"]
        raw = re.sub(r"\s+", "", d["imageBase64"])
        # tolerate url-safe / missing pad
        raw += "=" * (-len(raw) % 4)
        svg = base64.b64decode(raw).decode()
        code = "".join(re.findall(
            r"<text[^>]*\btransform='rotate\([^']*'[^>]*>([^<]+)</text>", svg))
        return d["captchaId"], code
    cid, code = cap()
    p = {"appCode": "system", "username": "admin", "password": "Mis@123456",
         "captchaId": cid, "captchaCode": code}
    tok = json.loads(urllib.request.urlopen(
        urllib.request.Request("http://localhost:8080/api/v1/auth/login",
                               data=json.dumps(p).encode(),
                               headers={"Content-Type": "application/json"},
                               method="POST"), timeout=10).read().decode())["data"]["token"]
    with open(TOKEN_FILE, "w") as f:
        f.write(tok)
else:
    with open(TOKEN_FILE) as f:
        tok = f.read().strip()
print("token len=%d" % len(tok))

for qs in ["sessionId=probe1", "sid=probe2", "", "channel=web&sessionId=probe3",
           "sessionId=probe1&channel=web"]:
    url = "http://localhost:8080/api/v1/events/stream?" + qs
    try:
        r = urllib.request.urlopen(
            urllib.request.Request(url, headers={"Authorization": "Bearer " + tok}),
            timeout=4)
        print("OK   %-40s -> %d" % (qs, r.status))
    except urllib.error.HTTPError as e:
        print("HTTP %d %-40s -> %s" % (e.code, qs, e.read().decode()[:160]))
    except Exception as e:
        print("ERR  %-40s -> %s" % (qs, str(e)[:100]))
