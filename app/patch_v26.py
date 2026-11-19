#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""v26：宏写入前先解锁键盘（Vial unlock 0xFE 05/06/07/08）"""
import io
import os
import sys

APP = os.path.dirname(os.path.abspath(__file__))


def rd(n):
    with io.open(os.path.join(APP, n), "r", encoding="utf-8") as f:
        return f.read()


def wr(n, t):
    with io.open(os.path.join(APP, n), "w", encoding="utf-8", newline="") as f:
        f.write(t)


def sub(t, old, new, label):
    if old not in t:
        print("!! MISS:", label)
        sys.exit(1)
    return t.replace(old, new, 1)


# ---------------- HTML ----------------
html = rd("index.html")

old = '''        <div class="macroBar">'''
new = '''        <div class="unlockBar" id="unlockBar">
          <div class="ubarRow">
            <span class="ulockState" id="lockState">锁状态：读取中…</span>
            <button class="softbtn" id="btnUnlock">解锁键盘</button>
            <button class="softbtn" id="btnLock" hidden>重新上锁</button>
          </div>
          <div class="ubarTrack"><div class="ubarFill" id="ubarFill"></div></div>
          <div class="ulockHint" id="unlockHint"></div>
        </div>

        <div class="macroBar">'''
html = sub(html, old, new, "unlock bar")
wr("index.html", html)

# 移除旧的"拒绝写入"警示（现在能写了）
html = rd("index.html")
import re
html = re.sub(r'\s*<div class="macroWarn">.*?</div>', "", html, count=1, flags=re.S)
wr("index.html", html)

# ---------------- CSS ----------------
css = rd("app.css")
css += """
/* ---------- v26：解锁条 ---------- */
.unlockBar{max-width:920px;margin-bottom:14px;padding:12px 16px;border-radius:14px;background:#f8fafd;border:1px solid var(--line)}
.ubarRow{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ulockState{font-size:13px;font-weight:600}
.ulockState.on{color:#0d7a3d}
.ulockState.off{color:#b45309}
.ubarTrack{height:6px;border-radius:999px;background:#e6ebf3;margin-top:10px;overflow:hidden;display:none}
.ubarTrack.show{display:block}
.ubarFill{height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#4a86ff,#2563eb);transition:width .1s linear}
.ulockHint{font-size:12.5px;color:var(--muted);margin-top:8px;line-height:1.7}
.ulockHint b{color:var(--text)}
"""
wr("app.css", css)

# ---------------- JS ----------------
js = rd("app.js")

anchor = "  async function readMacroBuffer() {"
module = r'''  /* ---- Vial 解锁（写宏前必须） ---- */
  async function readUnlockStatus() {
    const r = await xfer([0xfe, 0x05], 800);
    const pairs = [];
    for (let i = 2; i + 1 < 32; i += 2) {
      if (r[i] === 0xff || r[i] === 0x00) break;
      pairs.push([r[i], r[i + 1]]);
    }
    return { unlocked: !!r[0], inProgress: !!r[1], pairs };
  }

  function keysForPairs(pairs) {
    const names = [];
    pairs.forEach(([r, c]) => {
      const k = S.keys.find((x) => x.r === r && x.c === c);
      names.push(k ? kcOf(kcAt(r, c, 0)).t || (r + "," + c) : (r + "," + c));
    });
    return names;
  }

  function setLockUI(st) {
    const el = $("#lockState");
    if (!el) return;
    if (st.unlocked) {
      el.textContent = "🔓 已解锁（可以写入）";
      el.className = "ulockState on";
      $("#btnUnlock").hidden = true;
      $("#btnLock").hidden = false;
    } else {
      el.textContent = "🔒 已锁定（写宏前需解锁）";
      el.className = "ulockState off";
      $("#btnUnlock").hidden = false;
      $("#btnLock").hidden = true;
    }
  }

  async function refreshLock() {
    if (!S.on) { $("#lockState").textContent = "未连接"; return; }
    try {
      const st = await readUnlockStatus();
      setLockUI(st);
      const names = keysForPairs(st.pairs);
      $("#unlockHint").innerHTML = st.unlocked
        ? "解锁状态下才能写入宏。拔掉键盘或点「重新上锁」会恢复锁定。"
        : "点「解锁键盘」，然后<b>按住</b>键盘上的 " + (names.map((n) => "<b>" + n + "</b>").join(" + ") || "指定按键") + " 不放，直到进度条走完（约 5 秒）。";
    } catch (e) {
      $("#lockState").textContent = "解锁状态读取失败：" + e.message;
    }
  }

  async function unlockKeyboard() {
    if (!S.on) return toast("还没连接键盘", "err");
    try {
      const st0 = await readUnlockStatus();
      if (st0.unlocked) { setLockUI(st0); return toast("已经是解锁状态", "ok"); }

      const names = keysForPairs(st0.pairs);
      $("#unlockHint").innerHTML = "请<b>按住</b> " + (names.map((n) => "<b>" + n + "</b>").join(" + ") || "指定按键") + " 不放，进度条走完即解锁。";
      $("#ubarTrack") ? null : null;
      document.querySelector(".ubarTrack").classList.add("show");
      $("#ubarFill").style.width = "0%";

      await xfer([0xfe, 0x06], 800);        // unlock_start
      let ok = false;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 60));
        let r;
        try { r = await xfer([0xfe, 0x07], 600); } catch (e) { break; }
        const unlocked = !!r[0], inProg = !!r[1], counter = r[2];
        const pct = Math.max(0, Math.min(100, Math.round((1 - counter / 50) * 100)));
        $("#ubarFill").style.width = pct + "%";
        if (unlocked) { ok = true; break; }
        if (!inProg) break;                 // 松手了，解锁中断
      }
      if (ok) {
        setLockUI({ unlocked: true });
        $("#ubarFill").style.width = "100%";
        toast("已解锁，可以保存宏了", "ok");
        setTimeout(() => document.querySelector(".ubarTrack").classList.remove("show"), 800);
      } else {
        toast("解锁未完成：请按住提示的按键不要松手", "err");
        $("#unlockHint").innerHTML = "解锁中断了（可能是没按住、或中途松手）。再点一次「解锁键盘」重试。";
        document.querySelector(".ubarTrack").classList.remove("show");
      }
    } catch (e) {
      toast("解锁失败：" + e.message, "err");
    }
  }

  async function lockKeyboard() {
    try {
      await xfer([0xfe, 0x08], 600);
      await refreshLock();
      toast("已重新上锁", "ok");
    } catch (e) { toast("上锁失败：" + e.message, "err"); }
  }

  async function readMacroBuffer() {'''
js = sub(js, anchor, module, "unlock module")

# 进宏页时刷新锁状态
js = sub(js, '''    if (v === "macro") { renderMacros(); if (S.on) loadMacros(); }''',
         '''    if (v === "macro") { renderMacros(); if (S.on) { loadMacros(); refreshLock(); } }''',
         "view macro lock")

# 保存前检查解锁
old = '''  async function saveMacros() {
    if (!S.on) return toast("还没连接键盘", "err");'''
new = '''  async function saveMacros() {
    if (!S.on) return toast("还没连接键盘", "err");
    try {
      const st = await readUnlockStatus();
      if (!st.unlocked) {
        toast("键盘是锁定状态，请先点「解锁键盘」并按住提示的键", "err");
        $("#unlockHint").innerHTML = "写宏前必须先解锁：点上面的<b>「解锁键盘」</b>，然后按住提示的按键 5 秒。";
        return;
      }
    } catch (e) { /* 读不到就照常尝试 */ }'''
js = sub(js, old, new, "save guard")

# 绑定按钮
js = sub(js, '''    $("#btnMacroRead").onclick = () => loadMacros();''',
         '''    $("#btnUnlock").onclick = () => unlockKeyboard();
    $("#btnLock").onclick = () => lockKeyboard();
    $("#btnMacroRead").onclick = () => loadMacros();''',
         "bind unlock")

wr("app.js", js)
print("ok")
