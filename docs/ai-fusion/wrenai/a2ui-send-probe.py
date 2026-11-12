#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
a2ui-send-probe.py -- send one a2ui_chat on WS@3100 and probe Redis
aip:stream:inbound:h5 XLEN before/after, to verify Gateway actually XADDs.
"""
import base64, json, os, socket, struct, sys, time
import urllib.request, urllib.error

GATEWAY = "localhost", 3100
REDIS_HOST, REDIS_PORT = "10.254.16.6", 6379
REDIS_DB = 2
INBOUND_KEY = "aip:stream:inbound:h5"


def redis_xlen(key):
    s = socket.create_connection((REDIS_HOST, REDIS_PORT), timeout=5)
    # SELECT db
    s.sendall(("*2\r\n$6\r\nSELECT\r\n$%d\r\n%d\r\n" % (len(str(REDIS_DB)), REDIS_DB)).encode())
    time.sleep(0.2); s.recv(64)
    s.sendall(("*2\r\n$4\r\nXLEN\r\n$%d\r\n%s\r\n" % (len(key), key)).encode())
    time.sleep(0.3)
    try:
        data = s.recv(256)
    except Exception:
        data = b""
    s.close()
    m = data.strip().split(b"\r\n")
    # RESP integer: ":<n>\r\n"
    for part in m:
        if part.startswith(b":"):
            try:
                return int(part[1:])
            except Exception:
                pass
    return -1


def ws_send(token, sid, payload_str, hold=8):
    gh, gp = GATEWAY
    path = "/ws/chat?sessionId=" + sid
    s = socket.create_connection((gh, gp), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    hdr = (
        "GET %s HTTP/1.1\r\n" % path +
        "Host: %s:%d\r\n" % (gh, gp) +
        "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: %s\r\n" % key +
        "Authorization: Bearer %s\r\n" % token +
        "Origin: http://%s:%d\r\n\r\n" % (gh, gp)
    )
    s.sendall(hdr.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        buf += s.recv(1)
    if b"101" not in buf:
        print("  [WS] NOT upgraded: %r" % buf[:200]); s.close(); return
    print("  [WS] 101 upgrade OK")
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
    print("  [WS] a2ui_chat frame sent; holding socket %ds" % hold)
    # read any inbound WS frames (Gateway may echo errors)
    s.settimeout(1.0)
    acc = b""
    end = time.time() + hold
    while time.time() < end:
        try:
            d = s.recv(4096)
            if not d:
                break
            acc += d
        except Exception:
            time.sleep(0.2)
    s.close()
    if acc:
        print("  [WS] recv %d bytes (possible error frame): %r" % (len(acc), acc[:400]))


def main():
    tkf = os.path.join(os.environ.get("TEMP", "/tmp"), "a2ui_token.txt")
    token = open(tkf).read().strip()
    print("token len=%d" % len(token))

    sid = "a2ui-probe-" + str(int(time.time()))
    payload = {
        "type": "chat",
        "sessionId": sid,
        "messageType": "a2ui_chat",
        "metadata": {"a2ui": True},
        "content": "monthly sales by channel",
        "timestamp": "2026-08-24T00:00:00Z",
    }
    payload_str = json.dumps(payload)

    before = redis_xlen(INBOUND_KEY)
    print("BEFORE  %s XLEN = %s" % (INBOUND_KEY, before))

    print("=== sending a2ui_chat (sid=%s) ===" % sid)
    ws_send(token, sid, payload_str, hold=8)

    time.sleep(1)
    after = redis_xlen(INBOUND_KEY)
    print("AFTER   %s XLEN = %s" % (INBOUND_KEY, after))

    if after > before:
        print("=== RESULT: Gateway DID XADD inbound (delta=%d) ===" % (after - before))
    else:
        print("=== RESULT: Gateway did NOT write inbound (no change) ===")
        print("  -> runChat/sendToPython/route chain broken or Redis mismatch")
    return 0


if __name__ == "__main__":
    sys.exit(main())
