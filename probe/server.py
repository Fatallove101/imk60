#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
iMK60 探针服务
- 在 127.0.0.1 上提供静态页面（探针页）
- 接收浏览器 POST /dump 的键盘数据，落盘成 device_dump.json
用法: python server.py [port]
"""
import http.server
import json
import os
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        # 安静一点，只保留错误
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if self.path.split("?")[0] in ("/dump", "/api/dump"):
            try:
                data = json.loads(raw.decode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                self._json(400, {"ok": False, "error": "bad json: %s" % exc})
                return

            target = os.path.join(ROOT, "device_dump.json")
            with open(target, "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)
            # 同时留一份带时间戳的，防止覆盖丢数据
            stamp = time.strftime("%Y%m%d-%H%M%S")
            with open(os.path.join(ROOT, "dump-%s.json" % stamp), "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=2)

            print("[OK] 已保存 %s (%d bytes)" % (target, os.path.getsize(target)))
            self._json(200, {"ok": True, "saved": target})
            return

        self._json(404, {"ok": False, "error": "not found"})

    def do_GET(self):
        if self.path.split("?")[0] in ("/dump", "/api/dump"):
            target = os.path.join(ROOT, "device_dump.json")
            if os.path.exists(target):
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                with open(target, "rb") as fh:
                    body = fh.read()
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            else:
                self._json(404, {"ok": False})
            return
        super().do_GET()


def setup_console():
    """让中文在 cmd 窗口里正常显示，不依赖外面怎么设置"""
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    except Exception:  # noqa: BLE001
        pass
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass


def main():
    setup_console()
    os.chdir(ROOT)
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print("端口 %d 已被占用——可能探针窗口已经开着了。" % PORT)
        print("请回到那个窗口继续操作，或先把它关掉再重试。")
        time.sleep(6)
        return

    with httpd:
        url = "http://127.0.0.1:%d/" % PORT
        print("探针服务已启动: %s" % url)
        print("浏览器会自动打开；若没反应，请手动复制上面的地址到 Chrome/Edge。")
        print("按 Ctrl+C 结束")

        def open_later():
            time.sleep(1.0)
            try:
                webbrowser.open(url)
            except Exception:  # noqa: BLE001
                pass

        if not os.environ.get("NO_BROWSER"):
            threading.Thread(target=open_later, daemon=True).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")


if __name__ == "__main__":
    main()
