#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
a2ui-smoke-token.py -- A2UI smoke reusing a cached valid token.

Skips login (captcha is random SVG/PNG and cannot be decoded reliably).
Reads token from $TEMP/a2ui_token.txt (produced by a2ui-smoke-run.py).

Flow: background SSE subscribe -> WS send a2ui_chat -> wait -> assert done/messageId/plan fence.
"""
import argparse, json, os, re, socket, struct, threading, time, urllib.request, urllib.error, base64

HOST = "http://localhost:8080"


def sse_subscribe(token, sid, outfile, stop, duration):
    url = HOST + "/api/v1/events/stream?sessionId=" + sid
    headers = {"Authorization": "Bearer " + token, "Accept": "text/event-stream"}
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=duration + 5) as r:
            with open(outfile, "wb") as f:
                start = time.time()
                while not stop.is_set() and (time.time() - start) < duration:
                    try:
                        chunk = r.read(1)
                    except Exception:
                        break
                    if not chunk:
                        break
                    f.write(chunk); f.flush()
    except urllib.error.HTTPError as e:
        body = ""
        try: body = e.read().decode("utf-8", "ignore")
        except Exception: pass
        with open(outfile, "ab") as f:
            f.write(("\n[SSE_HTTP_%d] %s\n" % (e.code, body[:2000])).encode())
    except Exception as e:
        with open(outfile, "ab") as f:
            f.write(("\n[SSE_ERROR] %s\n" % str(e)).encode())


def ws_send(token, sid, payload_str, gh, gp):
    path = "/api/v1/ws/chat?token=" + token
    s = socket.create_connection((gh, gp), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    hdr = ("GET %s HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n"
           "Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n"
           "Sec-WebSocket-Key: %s\r\nOrigin: http://%s:%d\r\n\r\n") % (
        path, gh, gp, key, gh, gp)
    s.sendall(hdr.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(1)
    data = payload_str.encode("utf-8"); n = len(data)
    if n < 126: frame = bytes([0x81, 0x80 | n])
    elif n < 65536: frame = bytes([0x81, 0x80 | 126]) + struct.pack(">H", n)
    else: frame = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", n)
    mask = os.urandom(4)
    masked = bytes(data[i] ^ mask[i % 4] for i in range(n))
    s.sendall(frame + mask + masked)
    time.sleep(1.5); s.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="localhost:8080")
    ap.add_argument("--wait", type=int, default=35)
    args = ap.parse_args()
    global HOST; HOST = "http://" + args.host
    gh, gp = args.host.split(":")[0], int(args.host.split(":")[1])

    tk = os.path.join(os.environ.get("TEMP", "/tmp"), "a2ui_token.txt")
    token = open(tk).read().strip()
    print("token len=%d" % len(token))

    sid = "a2ui-smoke-" + str(int(time.time()))
    outfile = os.path.join(os.environ.get("TEMP", "/tmp"), "a2ui_sse_" + sid + ".log")
    payload = {"type": "chat", "sessionId": sid, "messageType": "a2ui_chat",
               "metadata": {"a2ui": True}, "content": "monthly sales by channel",
               "timestamp": "2026-08-24T00:00:00Z"}
    print("sessionId=" + sid); print("sseFile=" + outfile)
    stop = threading.Event()
    t = threading.Thread(target=sse_subscribe, args=(token, sid, outfile, stop, args.wait))
    t.start(); time.sleep(2)
    print("WS send a2ui_chat")
    ws_send(token, sid, json.dumps(payload), gh, gp)
    print("wait %ds" % args.wait); time.sleep(args.wait)
    stop.set(); t.join(timeout=3)

    raw = open(outfile, encoding="utf-8", errors="ignore").read() if os.path.exists(outfile) else ""
    has_done = bool(re.search(r'"type"\s*:\s*"done"', raw))
    mid = re.search(r'"messageId"\s*:\s*"([^"]+)"', raw) or re.search(r'"message_id"\s*:\s*"([^"]+)"', raw)
    mid = mid.group(1) if mid else ""
    sid2 = re.search(r'"sessionId"\s*:\s*"([^"]+)"', raw) or re.search(r'"session_id"\s*:\s*"([^"]+)"', raw)
    sid2 = sid2.group(1) if sid2 else ""
    plan = len(re.findall(r"iqd-plan", raw)); cite = len(re.findall(r"iqd-citations", raw))
    has_err = bool(re.search(r'"type"\s*:\s*"error"', raw))
    print("has_done=%s messageId=%s sessionId=%s plan=%d cite=%d err=%s" % (
        has_done, mid or "<MISSING>", sid2 or "<MISSING>", plan, cite, has_err))
    print("sseFile=" + outfile)
    ok = has_done and bool(mid)
    print("RESULT: %s" % ("PASS" if ok else "FAIL"))
    if has_err or "SSE_HTTP" in raw:
        print("--- tail ---"); print(raw[-1500:])
    return 0 if ok else 1


if __name__ == "__main__":
    import sys; sys.exit(main())
