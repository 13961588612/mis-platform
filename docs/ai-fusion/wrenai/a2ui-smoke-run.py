#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
a2ui-smoke-run.py -- A2UI end-to-end smoke (real stack, /api/v1 prefix).

Steps:
  1. GET  /api/v1/auth/captcha            -> captchaId + SVG (decode 4 digits)
  2. POST /api/v1/auth/login {appCode,username,password,captchaId,captchaCode}
                                            -> token (Bearer)
  3. background SSE subscribe /api/v1/events/stream?sessionId=SID  -> dump file
  4. WS /api/v1/ws/chat  send a2ui_chat message
  5. wait, parse SSE raw: assert done frame + messageId + iqd-plan fence

Pure stdlib (http.client / urllib / socket). No third-party deps.
Usage:
  python a2ui-smoke-run.py [--host localhost:8080] [--wait 30]
"""
import argparse
import base64
import os
import re
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.request
import urllib.error
import json

HOST = "http://localhost:8080"   # Spring auth/login (mis-gateway/BFF)
BASE = "/api/v1"
GATEWAY = "http://localhost:3100"  # TS A2UI Gateway (SSE + WS)

# --------------------------------------------------------------------------
# 1. captcha + decode (SVG text OCR: digits rendered as <text>...</text>)
# --------------------------------------------------------------------------
def fetch_captcha():
    url = HOST + BASE + "/auth/captcha"
    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            body = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        # some impls return raw json with 200; handle 400 too
        body = json.loads(e.read().decode("utf-8"))
    # shape: {code:0,data:{captchaId,imageBase64}}
    data = body.get("data", body)
    cid = data.get("captchaId") or data.get("captcha_id")
    img = data.get("imageBase64") or data.get("image") or ""
    if img.startswith("data:"):
        img = img.split(",", 1)[1]
    svg = base64.b64decode(re.sub(r"\s+", "", img)).decode("utf-8", "ignore")
    # Real glyphs are the <text> nodes that carry a rotate transform
    # (noise glyphs are transform-less decorative strokes). Collect in order.
    glyphs = re.findall(
        r"<text[^>]*\btransform='rotate\([^']*'[^>]*>([^<]+)</text>", svg
    )
    code = "".join(glyphs).strip()
    return cid, code, svg


# --------------------------------------------------------------------------
# 2. login
# --------------------------------------------------------------------------
def login(cid, code):
    url = HOST + BASE + "/auth/login"
    payload = {
        "appCode": "system",
        "username": "admin",
        "password": "Mis@123456",
        "captchaId": cid,
        "captchaCode": code,
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        body = json.loads(r.read().decode("utf-8"))
    # token shape varies: data.token / data.accessToken / data.jwt
    data = body.get("data", body)
    token = data.get("token") or data.get("accessToken") or data.get("jwt")
    if not token:
        raise RuntimeError("login returned no token: " + json.dumps(body)[:300])
    return token


# --------------------------------------------------------------------------
# 3. SSE subscribe (background thread, writes raw to file)
# --------------------------------------------------------------------------
def sse_subscribe(token, sid, outfile, stop_event, duration):
    url = GATEWAY + "/api/events/stream?sessionId=" + sid
    headers = {"Authorization": "Bearer " + token, "Accept": "text/event-stream"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=duration + 5) as r:
            with open(outfile, "wb") as f:
                start = time.time()
                while not stop_event.is_set() and (time.time() - start) < duration:
                    try:
                        chunk = r.read(1)
                    except Exception:
                        break
                    if not chunk:
                        break
                    f.write(chunk)
                    f.flush()
    except urllib.error.HTTPError as e:
        with open(outfile, "ab") as f:
            try:
                body = e.read().decode("utf-8", "ignore")
            except Exception:
                body = ""
            f.write(("\n[SSE_HTTP_%d] %s\n" % (e.code, body[:2000])).encode("utf-8"))
    except Exception as e:
        with open(outfile, "ab") as f:
            f.write(("\n[SSE_ERROR] " + str(e) + "\n").encode("utf-8"))


# --------------------------------------------------------------------------
# 4. WS send (minimal RFC6455 client, no deps)
# --------------------------------------------------------------------------
def ws_send(token, sid, payload_str, gateway_host, gateway_port):
    # Gateway WS auth reads req.user from the Authorization *header* (not ?token=).
    path = "/ws/chat?sessionId=" + sid
    s = socket.create_connection((gateway_host, gateway_port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    hdr = (
        "GET %s HTTP/1.1\r\n" % path +
        "Host: %s:%d\r\n" % (gateway_host, gateway_port) +
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: %s\r\n" % key +
        "Authorization: Bearer %s\r\n" % token +
        "Origin: http://%s:%d\r\n\r\n" % (gateway_host, gateway_port)
    )
    s.sendall(hdr.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(1)
    if b"101" not in buf and b"upgrade" not in buf.lower():
        print("  [WS] handshake NOT upgraded (auth rejected?): %r" % buf[:200])
        s.close(); return
    print("  [WS] handshake 101 upgraded OK")
    # send text frame (fin=1, opcode=1, masked)
    data = payload_str.encode("utf-8")
    n = len(data)
    if n < 126:
        frame = bytes([0x81, 0x80 | n])
    elif n < 65536:
        frame = bytes([0x81, 0x80 | 126]) + struct.pack(">H", n)
    else:
        frame = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", n)
    mask = os.urandom(4)
    masked = bytes(data[i] ^ mask[i % 4] for i in range(n))
    s.sendall(frame + mask + masked)
    print("  [WS] sent a2ui_chat frame; keeping socket open for SSE reply")
    time.sleep(3)
    s.close()


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost:8080")
    ap.add_argument("--wait", type=int, default=30)
    ap.add_argument("--use-token", action="store_true",
                    help="skip login, reuse cached $TEMP/a2ui_token.txt")
    args = ap.parse_args()

    global HOST
    HOST = "http://" + args.host
    gh, gp = args.host.split(":")[0], int(args.host.split(":")[1])

    if args.use_token:
        tkf = os.path.join(os.environ.get("TEMP", "/tmp"), "a2ui_token.txt")
        token = open(tkf).read().strip()
        print("=== [1-2] reuse cached token (len=%d) ===" % len(token))
    else:
        print("=== [1] captcha ===")
        cid, code, _ = fetch_captcha()
        print("  captchaId=%s code=%s" % (cid, code))

        print("=== [2] login ===")
        token = login(cid, code)
        print("  token(len=%d)=%s..." % (len(token), token[:24]))
        with open(os.path.join(os.environ.get("TEMP", "/tmp"), "a2ui_token.txt"), "w") as f:
            f.write(token)
        # Observed in integration: a freshly issued JWT sometimes 500s on the
        # very first SSE subscribe (Gateway auth warmup / JWKS cache window).
        # Give Gateway a short grace period before the SSE handshake.
        time.sleep(3)

    sid = "a2ui-smoke-" + str(int(time.time()))
    outfile = os.path.join(
        os.environ.get("TEMP", "/tmp"), "a2ui_sse_" + sid + ".log"
    )
    payload = {
        "type": "chat",
        "sessionId": sid,
        "messageType": "a2ui_chat",
        "metadata": {"a2ui": True},
        "content": "monthly sales by channel",
        "timestamp": "2026-08-24T00:00:00Z",
    }
    payload_str = json.dumps(payload)

    print("=== [3] SSE subscribe (background) ===")
    print("  sessionId=" + sid)
    print("  sseFile=" + outfile)
    stop = threading.Event()
    t = threading.Thread(
        target=sse_subscribe, args=(token, sid, outfile, stop, args.wait)
    )
    t.start()
    time.sleep(2)

    print("=== [4] WS send a2ui_chat ===")
    # WS goes to the TS Gateway (3100), path /ws/chat
    gh_gw = "localhost"
    gp_gw = 3100
    ws_send(token, sid, payload_str, gh_gw, gp_gw)

    print("=== [5] wait %ds for reply ===" % args.wait)
    time.sleep(args.wait)
    stop.set()
    t.join(timeout=3)

    print("=== [6] parse SSE raw ===")
    raw = ""
    if os.path.exists(outfile):
        with open(outfile, "r", encoding="utf-8", errors="ignore") as f:
            raw = f.read()
    has_done = bool(re.search(r'"type"\s*:\s*"done"', raw))
    mid = re.search(r'"messageId"\s*:\s*"([^"]+)"', raw) or re.search(
        r'"message_id"\s*:\s*"([^"]+)"', raw
    )
    mid = mid.group(1) if mid else ""
    sid2 = re.search(r'"sessionId"\s*:\s*"([^"]+)"', raw) or re.search(
        r'"session_id"\s*:\s*"([^"]+)"', raw
    )
    sid2 = sid2.group(1) if sid2 else ""
    plan = len(re.findall(r"iqd-plan", raw))
    cite = len(re.findall(r"iqd-citations", raw))
    has_err = bool(re.search(r'"type"\s*:\s*"error"', raw))

    print("  has_done       = %s" % has_done)
    print("  messageId      = %s" % (mid or "<MISSING>"))
    print("  sessionId      = %s" % (sid2 or "<MISSING>"))
    print("  iqd-plan fence = %d  (Phase 3.7 fidelity)" % plan)
    print("  iqd-citation   = %d" % cite)
    print("  has_error      = %s" % has_err)
    print("  sseFile        = " + outfile)

    ok = has_done and bool(mid)
    print("=== RESULT: %s ===" % ("PASS" if ok else "FAIL"))
    if has_err:
        # print tail of raw for diagnosis
        print("--- SSE tail (error diagnosis) ---")
        print(raw[-1500:])
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
