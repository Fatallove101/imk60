#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
imk60 改键器 - 本地服务
- 提供静态页面
- POST /backup        存一份备份到 backups/
- GET  /backup/last   取最近一份
"""
import http.server
import json
import os
import sys
import threading
import time
import webbrowser

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKUPS = os.path.join(ROOT, "backups")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8766


def setup_console():
    if os.name != "nt":
        return
    try:
        import ctypes
        ctypes.windll.kernel32.SetConsoleOutputCP(65001)
        ctypes.windll.kernel32.SetConsoleCP(65001)
    except Exception:
        pass
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
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
        path = self.path.split("?")[0]
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b""
        if path == "/backup":
            try:
                data = json.loads(raw.decode("utf-8"))
            except Exception as exc:  # noqa: BLE001
                return self._json(400, {"ok": False, "error": str(exc)})

            os.makedirs(BACKUPS, exist_ok=True)
            stamp = time.strftime("%Y%m%d-%H%M%S")
            name = "imk60-%s.json" % stamp
            with open(os.path.join(BACKUPS, name), "w", encoding="utf-8") as fh:
                json.dump(data, fh, ensure_ascii=False, indent=1)
            files = sorted(f for f in os.listdir(BACKUPS) if f.endswith(".json"))
            # 只保留最近 40 份
            for old in files[:-40]:
                try:
                    os.remove(os.path.join(BACKUPS, old))
                except OSError:
                    pass
            print("[备份] %s" % name)
            return self._json(200, {"ok": True, "file": name})

        self._json(404, {"ok": False})

    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/backup/last":
            os.makedirs(BACKUPS, exist_ok=True)
            files = sorted(f for f in os.listdir(BACKUPS) if f.endswith(".json"))
            if not files:
                return self._json(404, {"ok": False, "error": "no backup"})
            with open(os.path.join(BACKUPS, files[-1]), "r", encoding="utf-8") as fh:
                data = json.load(fh)
            data["file"] = files[-1]
            return self._json(200, data)
        if path == "/backup/list":
            os.makedirs(BACKUPS, exist_ok=True)
            return self._json(200, sorted(f for f in os.listdir(BACKUPS) if f.endswith(".json")))
        return super().do_GET()


def main():
    setup_console()
    os.chdir(ROOT)
    try:
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        print("端口 %d 已被占用——改键器可能已经在运行了。" % PORT)
        print("请直接打开 http://127.0.0.1:%d/ ，或先关掉旧窗口。" % PORT)
        time.sleep(8)
        return

    with httpd:
        url = "http://127.0.0.1:%d/" % PORT
        print("=" * 46)
        print("  imk60 改键器")
        print("  %s" % url)
        print("=" * 46)
        print("浏览器会自动打开。用 Chrome / Edge。")
        print("关闭本窗口 = 停止服务。")

        if not os.environ.get("NO_BROWSER"):
            def open_later():
                time.sleep(1.0)
                try:
                    webbrowser.open(url)
                except Exception:
                    pass
            threading.Thread(target=open_later, daemon=True).start()

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")


if __name__ == "__main__":
    main()
