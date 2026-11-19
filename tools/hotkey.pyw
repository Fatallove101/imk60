#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
imk60 驱动热键常驻工具
按下 F13（键盘上任一绑定了 F13 的键，例如 Fn+B）时：
  1. 若本地服务没在跑，自动启动 app/server.py
  2. 用默认浏览器打开驱动页面

纯标准库（ctypes + urllib），无需安装任何依赖。
日志写到 tools/hotkey.log
"""
import ctypes
from ctypes import wintypes
import os
import subprocess
import sys
import time
import urllib.request
import webbrowser

VK_F13 = 0x7C          # 0x7C = F13，常见软件都不占用
WM_HOTKEY = 0x0312
MOD_NOREPEAT = 0x4000
URL = "http://127.0.0.1:8766/"

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(TOOLS_DIR)
SERVER = os.path.join(APP_DIR, "app", "server.py")
LOG = os.path.join(TOOLS_DIR, "hotkey.log")


def log(msg):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%Y-%m-%d %H:%M:%S  ") + msg + "\n")
    except Exception:
        pass


def server_up(timeout=0.6):
    try:
        urllib.request.urlopen(URL, timeout=timeout)
        return True
    except Exception:
        return False


def ensure_server():
    if server_up():
        return
    exe = sys.executable
    pyw = exe[:-10] + "pythonw.exe" if exe.lower().endswith("python.exe") else exe
    try:
        subprocess.Popen(
            [pyw if os.path.exists(pyw) else exe, SERVER, "8766"],
            cwd=os.path.join(APP_DIR, "app"),
            creationflags=0x00000008,  # DETACHED_PROCESS
        )
        log("服务未运行，已启动: " + SERVER)
    except Exception as exc:
        log("启动服务失败: %r" % (exc,))
    for _ in range(20):
        time.sleep(0.25)
        if server_up():
            return


def launch():
    ensure_server()
    try:
        webbrowser.open(URL)
        log("已打开 " + URL)
    except Exception as exc:
        log("打开浏览器失败: %r" % (exc,))


def main():
    user32 = ctypes.windll.user32
    msg = wintypes.MSG()

    if not user32.RegisterHotKey(None, 1, MOD_NOREPEAT, VK_F13):
        log("注册 F13 热键失败（可能已被别的程序占用）")
        return 2

    log("热键已注册：F13 → 打开 " + URL)
    last = 0.0
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
        if msg.message == WM_HOTKEY:
            now = time.time()
            if now - last < 1.5:      # 防抖，避免连开多个标签页
                continue
            last = now
            launch()
    return 0


if __name__ == "__main__":
    sys.exit(main())
