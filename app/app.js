/* imk60 女战士驱动 */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  const CFG = { defSize: 432, gap: 5, minU: 34, maxU: 68 };

  const S = {
    dev: null, on: false, def: null, keys: [],
    rows: 5, cols: 14, layers: 3, cur: 0,
    km: {}, sel: null, view: "keymap", unit: 54,
    light: null, leds: null, ledColors: {}, ledColorsD: {}, lightTab: "keys", ledState: "idle",
    undo: [], polling: false, diag: false, drag: null,
  };

  /* ================= 传输 ================= */
  let chain = Promise.resolve();
  const hex = (a) => Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const hx = (n) => "0x" + (n || 0).toString(16).padStart(4, "0");

  function xfer(bytes, timeoutMs) {
    const run = chain.then(() => doXfer(bytes, timeoutMs || 800));
    chain = run.catch(() => {});
    return run;
  }
  async function doXfer(bytes, timeoutMs) {
    if (!S.dev || !S.dev.opened) throw new Error("设备未打开");
    const buf = new Uint8Array(32);
    buf.set(bytes.slice(0, 32));

    const wait = new Promise((resolve, reject) => {
      const on = (e) => { done(); resolve(new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength)); };
      const timer = setTimeout(() => { done(); reject(new Error("超时 " + hex(bytes.slice(0, 3)))); }, timeoutMs);
      function done() { clearTimeout(timer); S.dev.removeEventListener("inputreport", on); }
      S.dev.addEventListener("inputreport", on);
    });
    wait.catch(() => {});
    if (S.diag) diag("→ " + hex(bytes.slice(0, 10)));
    await S.dev.sendReport(0, buf);
    const resp = await wait;
    if (S.diag) diag("← " + hex(resp.slice(0, 10)));
    await new Promise((r) => setTimeout(r, 6));
    return resp;
  }

  /* ================= 通用 UI ================= */
  let toastTimer = null;
  function toast(msg, kind) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = "toast"; }, 2300);
  }
  function diag(line) {
    const el = $("#diagLog");
    el.textContent += line + "\n";
    if (el.textContent.length > 40000) el.textContent = el.textContent.slice(-30000);
    el.scrollTop = el.scrollHeight;
  }
  function setConn(text, state) {
    $("#connText").textContent = text;
    $("#connDot").className = "dot" + (state ? " " + state : "");
  }

  /* ================= 键码 ================= */
  let KC = new Map();
  function buildKeycodes(def) {
    KC = new Map();
    (window.KEYCODES || []).forEach((k) => KC.set(k.c, k));
    for (let i = 0; i < 8; i++) {
      const e = { c: 0x5700 + i, t: "TD" + i, s: "", n: "Tap Dance 槽位 " + i, g: "高级" };
      KC.set(e.c, e);
      window.KEYCODES.push(e);
    }
    if (window.KC_GROUPS.indexOf("高级") < 0) window.KC_GROUPS.push("高级");

    if (def && def.customKeycodes) {
      def.customKeycodes.forEach((ck, i) => {
        const CN = { Keylight: "轴灯开关", Underglow: "底灯开关" };
        const title = CN[ck.name] || ck.shortName || ck.name;
        const e = { c: 0x7e00 + i, t: title, s: "", n: ck.title || ck.name, g: "自定义" };
        KC.set(e.c, e);
        window.KEYCODES.push(e);
        if (window.KC_GROUPS.indexOf("自定义") < 0) window.KC_GROUPS.push("自定义");
      });
    }
  }
  function kcOf(code, r, c) {
    if (code === undefined || code === null) return { t: "", s: "", n: "未读取", g: "" };
    const hit = KC.get(code);
    if (hit) return hit;
    const legend = (r !== undefined && CAP_LEGENDS[r + "," + c]) || "";
    if (legend) return { t: legend, s: "", n: "Fn 功能（固件自定义键码）" + hx(code), g: "" };
    return { t: hx(code), s: "", n: "未知键码", g: "" };
  }
  const isMod = (c) => c >= 0xe0 && c <= 0xe7;

  /* 键帽上印的 Fn 层小字（按矩阵位置，来自厂家配列图） */
  const CAP_LEGENDS = {
    "0,2": "F1", "0,1": "F2", "0,3": "F3", "0,4": "F4", "0,5": "F5", "0,6": "F6",
    "0,7": "F7", "0,8": "F8", "0,9": "F9", "0,10": "F10", "0,11": "F11", "0,12": "F12",
    "1,2": "↑", "1,4": "灯速-", "1,5": "灯速+", "1,7": "Ins", "1,8": "Home", "1,9": "PgUp",
    "1,12": "蜂鸣模式", "1,13": "蜂鸣开关",
    "2,1": "←", "2,2": "↓", "2,3": "→", "2,4": "色相-", "2,5": "色相+",
    "2,6": "音量-", "2,7": "音量+", "2,10": "亮度-", "2,11": "亮度+", "2,12": "音频模式",
    "3,1": "全灯开关", "3,2": "灯效-", "3,3": "灯效+", "3,4": "饱和+", "3,5": "饱和-",
    "3,6": "轴灯亮+", "3,7": "轴灯亮-", "3,8": "声音-", "3,9": "声音+", "3,10": "静音",
    "4,0": "轴灯开关", "4,1": "底灯开关", "4,3": "播放/暂停",
  };

  /* ================= 布局解析 ================= */
  function parseLayout(def) {
    const keys = [];
    const rowsArr = (def.layouts && def.layouts.keymap) || [];
    rowsArr.forEach((row, ri) => {
      let x = 0, y = ri;
      const pend = {};
      row.forEach((item) => {
        if (typeof item === "string") {
          const m = item.split(",").map(Number);
          const w = pend.w || 1, h = pend.h || 1;
          keys.push({ x, y, w, h, r: m[0], c: m[1] });
          x += w;
          for (const k in pend) delete pend[k];
        } else if (item && typeof item === "object") {
          if (item.x) x += item.x;
          if (item.y) y += item.y;
          if (item.w) pend.w = item.w;
          if (item.h) pend.h = item.h;
        }
      });
    });
    return keys;
  }

  /* ================= 画键盘 ================= */
  function computeUnit() {
    const wrap = $(".canvasWrap");
    const avail = wrap.clientWidth - 8;
    const maxX = S.keys.reduce((m, k) => Math.max(m, k.x + k.w), 0) || 15;
    const maxY = S.keys.reduce((m, k) => Math.max(m, k.y + k.h), 0) || 5;
    const byW = Math.floor(avail / maxX);
    const byH = Math.floor((window.innerHeight * 0.40) / maxY);
    S.unit = Math.max(CFG.minU, Math.min(CFG.maxU, byW, byH));
  }

  function kcAt(r, c, layerIdx) {
    const layer = S.km[layerIdx === undefined ? S.cur : layerIdx];
    return layer ? layer[r * S.cols + c] : undefined;
  }
  /* 灯光/测试页固定显示主层，避免层切换把键位"弄丢" */
  function displayLayer() {
    return S.view === "keymap" ? S.cur : 0;
  }

  function renderBoard() {
    const board = $("#board");
    const U = S.unit, G = CFG.gap;
    const maxX = S.keys.reduce((m, k) => Math.max(m, k.x + k.w), 0) || 15;
    const maxY = S.keys.reduce((m, k) => Math.max(m, k.y + k.h), 0) || 5;
    board.style.width = maxX * U + "px";
    board.style.height = maxY * U + "px";
    board.innerHTML = "";

    S.keys.forEach((k) => {
      const code = kcAt(k.r, k.c, displayLayer());
      const info = kcOf(code, k.r, k.c);
      const el = document.createElement("div");
      el.className = "key";
      el.style.left = k.x * U + G / 2 + "px";
      el.style.top = k.y * U + G / 2 + "px";
      el.style.width = k.w * U - G + "px";
      el.style.height = k.h * U - G + "px";
      el.dataset.r = k.r;
      el.dataset.c = k.c;
      el.title = (info.n || info.t) + "  ·  " + hx(code) + "  ·  " + k.r + "," + k.c;

      if (code === 0x0001) el.classList.add("transparent");
      else if (isMod(code)) el.classList.add("mod");
      if (S.sel && S.sel.r === k.r && S.sel.c === k.c && S.view === "keymap") el.classList.add("sel");

      const led = document.createElement("div");
      led.className = "led";
      el.appendChild(led);
      const col = S.ledColors[k.r + "," + k.c];
      if (col) { el.classList.add("painted"); el.style.setProperty("--led", col); }

      const main = document.createElement("div");
      main.className = "k-main";
      main.textContent = info.t;
      el.appendChild(main);

      if (info.s) {
        const sub = document.createElement("div");
        sub.className = "k-sub";
        sub.textContent = info.s;
        el.appendChild(sub);
      }

      const legend = CAP_LEGENDS[k.r + "," + k.c];
      if (legend && legend !== info.t) {
        const fn = document.createElement("div");
        fn.className = "k-fn";
        fn.textContent = legend;
        el.appendChild(fn);
      }

      el.addEventListener("click", () => onKeyClick(k));
      el.addEventListener("contextmenu", (e) => { e.preventDefault(); onKeyRight(k); });
      el.addEventListener("mouseenter", (e) => { if (S.view === "light" && e.buttons === 1) paintKey(k); });
      el.draggable = S.view === "keymap" && S.on;
      el.addEventListener("dragstart", () => { S.drag = k; });
      el.addEventListener("dragover", (e) => { e.preventDefault(); });
      el.addEventListener("drop", (e) => { e.preventDefault(); onDrop(k); });
      board.appendChild(el);
    });
  }

  function onKeyClick(k) {
    if (S.view === "light") return paintKey(k);
    if (S.view !== "keymap") return;
    S.sel = { r: k.r, c: k.c };
    renderBoard(); renderSelChip(); renderPicker();
  }
  function onKeyRight(k) {
    if (S.view === "light") clearLedAt(k);
  }
  function onDrop(target) {
    const src = S.drag; S.drag = null;
    if (!src || (src.r === target.r && src.c === target.c)) return;
    const a = kcAt(src.r, src.c), b = kcAt(target.r, target.c);
    applyKeycode(b, { r: src.r, c: src.c });
    setTimeout(() => applyKeycode(a, { r: target.r, c: target.c }), 70);
  }

  function renderRail() {
    const rail = $("#layerRail");
    rail.innerHTML = "";
    rail.style.display = S.view === "keymap" ? "flex" : "none";
    const n = S.layers || 3;
    for (let i = 0; i < n; i++) {
      const b = document.createElement("button");
      b.className = "layerPill" + (i === S.cur ? " active" : "");
      b.textContent = i === 0 ? "主层" : "Fn" + i + "层";
      b.onclick = () => { S.cur = i; S.sel = null; renderRail(); renderBoard(); renderSelChip(); };
      rail.appendChild(b);
    }
  }

  function renderSelChip() {
    const chip = $("#selChip");
    if (!S.sel) {
      chip.innerHTML = '<span class="muted">未选中按键</span>';
      return;
    }
    const code = kcAt(S.sel.r, S.sel.c);
    const info = kcOf(code);
    chip.innerHTML = "";
    const name = document.createElement("span");
    name.textContent = info.n || info.t;
    const mono = document.createElement("span");
    mono.className = "mono";
    mono.textContent = hx(code) + " · " + S.sel.r + "," + S.sel.c;
    chip.appendChild(name); chip.appendChild(mono);
  }

  /* ================= 键码面板 ================= */
  const CATS = ["基础", "修饰", "层", "高级", "功能", "多媒体", "符号", "鼠标", "自定义"];
  let curCat = "基础";

  const ROWS = [
    [[0x29,1],[0x3a,1],[0x3b,1],[0x3c,1],[0x3d,1],[0x3e,1],[0x3f,1],[0x40,1],[0x41,1],[0x42,1],[0x43,1],[0x44,1],[0x45,1],[0x46,1],[0x47,1],[0x48,1]],
    [[0x35,1],[0x1e,1],[0x1f,1],[0x20,1],[0x21,1],[0x22,1],[0x23,1],[0x24,1],[0x25,1],[0x26,1],[0x27,1],[0x2d,1],[0x2e,1],[0x2a,2]],
    [[0x2b,1.5],[0x14,1],[0x1a,1],[0x08,1],[0x15,1],[0x17,1],[0x1c,1],[0x18,1],[0x0c,1],[0x12,1],[0x13,1],[0x2f,1],[0x30,1],[0x31,1.5]],
    [[0x39,1.75],[0x04,1],[0x16,1],[0x07,1],[0x09,1],[0x0a,1],[0x0b,1],[0x0d,1],[0x0e,1],[0x0f,1],[0x33,1],[0x34,1],[0x28,2.25]],
    [[0xe1,2.25],[0x1d,1],[0x1b,1],[0x06,1],[0x19,1],[0x05,1],[0x11,1],[0x10,1],[0x36,1],[0x37,1],[0x38,1],[0xe5,2.75]],
    [[0xe0,1.25],[0xe3,1.25],[0xe2,1.25],[0x2c,6.25],[0xe6,1.25],[0xe7,1.25],[0x65,1.25],[0xe4,1.25]],
  ];

  function renderTabs() {
    const box = $("#tabs");
    box.innerHTML = "";
    CATS.forEach((c) => {
      if (c === "自定义" && !(window.KEYCODES || []).some((k) => k.g === "自定义")) return;
      const b = document.createElement("button");
      b.className = "tab" + (c === curCat ? " active" : "");
      b.textContent = c;
      b.onclick = () => { curCat = c; renderTabs(); renderPicker(); };
      box.appendChild(b);
    });
  }

  function makeKeyEl(code, span) {
    const info = kcOf(code);
    const d = document.createElement("div");
    d.className = "pk";
    if (span) d.style.flex = span;
    const t = document.createElement("div");
    t.className = "t"; t.textContent = info.t;
    const s = document.createElement("div");
    s.className = "s"; s.textContent = info.n && info.n !== info.t ? info.n : (info.s || "");
    d.appendChild(t); d.appendChild(s);
    d.onclick = () => applyKeycode(code);
    return d;
  }

  function renderPicker() {
    const box = $("#picker");
    box.innerHTML = "";

    if (curCat === "基础") {
      ROWS.forEach((row) => {
        const r = document.createElement("div");
        r.className = "prow";
        row.forEach(([code, span]) => r.appendChild(makeKeyEl(code, span)));
        box.appendChild(r);
      });
      return;
    }

    const map = { "修饰": "修饰", "层": "层", "高级": "高级", "功能": "功能键", "多媒体": "媒体", "符号": "符号", "鼠标": "鼠标", "自定义": "自定义" };
    const g = map[curCat] || curCat;
    const list = (window.KEYCODES || []).filter((k) => k.g === g || (curCat === "符号" && k.g === "数字"));
    const row = document.createElement("div");
    row.className = "prow";
    row.style.flexWrap = "wrap";
    list.forEach((k) => {
      const el = makeKeyEl(k.c, null);
      el.classList.add("gridkey");
      row.appendChild(el);
    });
    box.appendChild(row);
  }

  /* ================= 写入键码 ================= */
  async function applyKeycode(code, target) {
    if (!S.on) return toast("还没连接键盘", "err");
    const sel = target || S.sel;
    if (!sel) return toast("先点一个键", "err");
    const old = kcAt(sel.r, sel.c);
    if (old === code) return;

    S.km[S.cur][sel.r * S.cols + sel.c] = code;
    renderBoard(); renderSelChip();

    try {
      await xfer([0x05, S.cur, sel.r, sel.c, (code >> 8) & 0xff, code & 0xff]);
      S.undo.push({ layer: S.cur, r: sel.r, c: sel.c, old });
      flash(sel.r, sel.c);
      toast("已改为 " + (kcOf(code).n || kcOf(code).t), "ok");
    } catch (e) {
      S.km[S.cur][sel.r * S.cols + sel.c] = old;
      renderBoard(); renderSelChip();
      toast("写入失败：" + e.message, "err");
    }
  }

  function flash(r, c) {
    const el = document.querySelector('.key[data-r="' + r + '"][data-c="' + c + '"]');
    if (!el) return;
    el.classList.add("flash");
    setTimeout(() => el.classList.remove("flash"), 560);
  }

  /* ================= 读取 ================= */
  async function layerCount() {
    try {
      const r = await xfer([0x11]);
      if (r[1] > 0 && r[1] <= 32) return r[1];
    } catch (e) { /* ignore */ }
    return 3;
  }

  async function readLayer(layer) {
    const per = S.rows * S.cols;
    const out = new Uint16Array(per);
    for (let i = 0; i < per; i += 14) {
      const off = layer * per * 2 + i * 2;
      const size = Math.min(28, (per - i) * 2);
      const resp = await xfer([0x12, (off >> 8) & 0xff, off & 0xff, size]);
      for (let j = 0; j < size / 2; j++) out[i + j] = (resp[4 + j * 2] << 8) | resp[5 + j * 2];
    }
    return out;
  }

  async function readAll() {
    S.layers = (await layerCount()) || 3;
    S.km = {};
    for (let l = 0; l < S.layers; l++) {
      setConn("读取第 " + l + " 层…", "busy");
      S.km[l] = await readLayer(l);
    }
  }

  /* ================= 灯效 ================= */
  const EFFECTS = {
    0: "关闭", 1: "逐键直控", 2: "纯色", 3: "字母发光", 4: "上下渐变", 5: "左右渐变",
    6: "呼吸", 7: "色带·饱和", 8: "色带·明度", 9: "风车·饱和", 10: "风车·明度",
    11: "螺旋·饱和", 12: "螺旋·明度", 13: "全局循环", 14: "左右循环", 15: "上下循环",
    16: "彩虹 V 形", 17: "向内循环", 18: "双向向内", 19: "风车循环", 20: "螺旋循环",
    21: "双灯塔", 22: "彩虹灯塔", 23: "彩虹风车", 24: "雨滴", 25: "果冻雨滴",
    26: "色相呼吸", 27: "色相摆动", 28: "色相波", 29: "打字热图", 30: "数字雨",
    31: "单点反应", 32: "反应", 33: "宽反应", 34: "多宽反应", 35: "十字反应",
    36: "多十字", 37: "连接反应", 38: "多连接", 39: "溅射", 40: "多溅射",
    41: "纯色溅射", 42: "纯色多溅射", 43: "像素雨", 44: "像素分形",
  };

  async function readLight() {
    try {
      const info = await xfer([0x08, 0x40], 600);
      if (info[1] !== 0x40) return null;
      const max = info[4] || 255;
      const m = await xfer([0x08, 0x41], 600);
      const id = m[2] | (m[3] << 8);
      const L = { max, id, speed: m[4], hue: m[5], sat: m[6], val: m[7], supported: [] };

      let gt = 0;
      try {
        for (let i = 0; i < 14; i++) {
          const r = await xfer([0x08, 0x42, gt & 0xff, (gt >> 8) & 0xff], 450);
          let added = false;
          for (let j = 2; j + 1 < 32; j += 2) {
            const v = r[j] | (r[j + 1] << 8);
            if (v === 0xffff) break;
            if (v > gt) { L.supported.push(v); gt = v; added = true; }
          }
          if (!added) break;
        }
      } catch (e) { diag("效果列表失败: " + e.message); }
      return L;
    } catch (e) {
      diag("灯效不可用: " + e.message);
      return null;
    }
  }

  async function readLeds() {
    S.ledState = "loading";
    try {
      const n = await xfer([0x08, 0x43], 900);
      const count = n[2] | (n[3] << 8);
      if (!count || count > 400) { S.ledState = "unsupported"; return null; }
      const map = {}, deco = [];
      for (let i = 0; i < count; i++) {
        const r = await xfer([0x08, 0x44, i & 0xff, (i >> 8) & 0xff], 500);
        const row = r[5], col = r[6];
        if (row === 0xff || col === 0xff) deco.push(i);
        else map[row + "," + col] = i;
      }
      S.ledState = "ok";
      return { count, map, deco };
    } catch (e) {
      diag("LED 信息不可用: " + e.message);
      S.ledState = "unsupported";
      return null;
    }
  }

  async function setMode(id) {
    if (!S.light) return;
    Object.assign(S.light, { id });
    const L = S.light;
    try {
      await xfer([0x07, 0x41, L.id & 0xff, (L.id >> 8) & 0xff, L.speed, L.hue, L.sat, L.val]);
    } catch (e) { toast("灯效写入失败：" + e.message, "err"); }
    renderEffects();
    startPreview();
  }

  async function pushParams() {
    if (!S.light) return;
    const L = S.light;
    try {
      await xfer([0x07, 0x41, L.id & 0xff, (L.id >> 8) & 0xff, L.speed, L.hue, L.sat, L.val]);
    } catch (e) { /* ignore */ }
    if (S.view === "light" && !pvRaf) startPreview();
  }

  async function fastSet(idx, h, s, v) {
    await xfer([0x07, 0x42, idx & 0xff, (idx >> 8) & 0xff, 1, h & 0xff, s & 0xff, v & 0xff]);
  }

  async function ensureDirect() {
    if (!S.light) return false;
    if (S.light.id !== 1) await setMode(1);
    return true;
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await xfer([0x09], 500); } catch (e) { /* 固件可能不支持，忽略 */ }
    }, 1200);
  }

  async function paintKey(k) {
    if (!S.light) return;
    if (!S.leds) {
      S.leds = await readLeds();
      if (!S.leds) {
        toast("固件不支持逐颗灯珠控制，请用「纯色」统一改色", "err");
        return;
      }
      updateLedInfo();
    }
    const idx = S.leds.map[k.r + "," + k.c];
    if (idx === undefined) return;
    if (!(await ensureDirect())) return;
    const L = S.light;
    try {
      await fastSet(idx, L.hue, L.sat, L.val);
      S.ledColors[k.r + "," + k.c] = hsvCss(L.hue, L.sat, L.val);
      const el = document.querySelector('.key[data-r="' + k.r + '"][data-c="' + k.c + '"]');
      if (el) { el.style.setProperty("--led", S.ledColors[k.r + "," + k.c]); el.classList.add("painted"); }
      scheduleSave();
    } catch (e) { /* ignore */ }
  }

  async function clearLedAt(k) {
    const idx = S.leds && S.leds.map[k.r + "," + k.c];
    if (idx === undefined) return;
    try { await fastSet(idx, 0, 0, 0); } catch (e) { /* ignore */ }
    delete S.ledColors[k.r + "," + k.c];
    const el = document.querySelector('.key[data-r="' + k.r + '"][data-c="' + k.c + '"]');
    if (el) el.classList.remove("painted");
    scheduleSave();
  }

  function hsvCss(h, s, v) {
    const H = (h / 255) * 360, S1 = s / 255, V = v / 255;
    const c = V * S1, x = c * (1 - Math.abs(((H / 60) % 2) - 1)), m = V - c;
    let r = 0, g = 0, b = 0;
    if (H < 60) { r = c; g = x; } else if (H < 120) { r = x; g = c; }
    else if (H < 180) { g = c; b = x; } else if (H < 240) { g = x; b = c; }
    else if (H < 300) { r = x; b = c; } else { r = c; b = x; }
    const to = (n) => Math.round((n + m) * 255);
    return "rgb(" + to(r) + "," + to(g) + "," + to(b) + ")";
  }
  function hsvToHex(h, s, v) {
    const css = hsvCss(h, s, v);
    const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(css);
    const p = (n) => Number(n).toString(16).padStart(2, "0");
    return "#" + p(m[1]) + p(m[2]) + p(m[3]);
  }

  /* ---------- 灯效本地动画预览 ---------- */
  let pvRaf = 0, pvT0 = 0;

  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const mixH = (base, delta) => ((base + delta) % 256 + 256) % 256;

  function pvSolid() { return { h: S.light.hue, s: S.light.sat, v: S.light.val }; }

  const PREVIEWS = {
    1: (t, k) => {
      const css = S.ledColors[k.r + "," + k.c];
      return css ? { css: css } : null;
    },
    2: () => pvSolid(),
    3: (t, k) => (k.r >= 1 && k.r <= 4)
      ? pvSolid()
      : { h: 0, s: 0, v: 14 },
    4: (t, k) => ({ h: mixH(S.light.hue, k.y * 26), s: S.light.sat, v: S.light.val }),
    5: (t, k) => ({ h: mixH(S.light.hue, k.x * 14), s: S.light.sat, v: S.light.val }),
    6: (t) => ({
      h: S.light.hue, s: S.light.sat,
      v: Math.round(S.light.val * (0.32 + 0.68 * (0.5 + 0.5 * Math.sin(t * 2.2)))),
    }),
    13: (t, k) => ({ h: mixH(S.light.hue, t * 70), s: S.light.sat, v: S.light.val }),
    14: (t, k) => ({ h: mixH(S.light.hue, k.x * 12 + t * 55), s: S.light.sat, v: S.light.val }),
    15: (t, k) => ({ h: mixH(S.light.hue, k.y * 22 + t * 55), s: S.light.sat, v: S.light.val }),
    16: (t, k) => ({ h: mixH(S.light.hue, Math.abs(k.x - 7) * 18 + t * 40), s: S.light.sat, v: S.light.val }),
    17: (t, k) => {
      const d = Math.abs(k.x - 7) + Math.abs(k.y - 2);
      return { h: mixH(S.light.hue, d * 22 + t * 30), s: S.light.sat, v: S.light.val };
    },
    18: (t, k) => {
      const d = Math.max(Math.abs(k.x - 7), Math.abs(k.y - 2));
      return { h: mixH(S.light.hue, d * 26 + t * 30), s: S.light.sat, v: S.light.val };
    },
    23: (t, k) => {
      const a = Math.atan2(k.y - 2, k.x - 7) * 180 / Math.PI;
      return { h: mixH(S.light.hue, (a + 180) * 0.7 + t * 45), s: S.light.sat, v: S.light.val };
    },
  };

  function paintEl(el, col) {
    if (!el) return;
    if (!col) { el.classList.remove("painted"); return; }
    el.classList.add("painted");
    el.style.setProperty("--led", col.css ? col.css : hsvCss(col.h, col.s, Math.max(0, Math.min(255, col.v))));
  }

  function stopPreview() {
    if (pvRaf) cancelAnimationFrame(pvRaf);
    pvRaf = 0;
  }

  function clearPreview() {
    $$(".key.painted").forEach((el) => el.classList.remove("painted"));
  }

  function startPreview() {
    stopPreview();
    if (!S.light || S.view !== "light") return;
    const fn = PREVIEWS[S.light.id];
    if (!fn) { clearPreview(); return; }
    pvT0 = performance.now();
    const speed = 0.35 + (S.light.speed / 255) * 1.65;
    const loop = (ts) => {
      if (!S.light || S.view !== "light") { pvRaf = 0; return; }
      const t = ((ts - pvT0) / 1000) * speed;
      S.keys.forEach((k) => {
        const el = document.querySelector('.key[data-r="' + k.r + '"][data-c="' + k.c + '"]');
        paintEl(el, fn(t, k));
      });
      pvRaf = requestAnimationFrame(loop);
    };
    pvRaf = requestAnimationFrame(loop);
  }

  /* ---------- 底灯（装饰灯） ---------- */
  function buildDeco() {
    const strip = $("#decoStrip");
    if (!strip) return;
    strip.innerHTML = "";
    if (S.lightTab !== "deco") { strip.hidden = true; return; }
    strip.hidden = false;
    if (!S.leds) {
      strip.innerHTML = "";
      if (!S.on) { strip.innerHTML = '<span class="dt">底灯：未连接</span>'; return; }
      if (S.ledState === "loading" || S.ledState === "idle") {
        strip.innerHTML = '<span class="dt">底灯：读取中…</span>';
        return;
      }
      const box = document.createElement("div");
      box.className = "decoWarn";
      box.innerHTML =
        '<b>固件没有开放「逐颗灯珠控制」</b>（未编译 VIALRGB_DIRECT），所以读不到每颗灯的位置。<br>' +
        '这不影响用灯效——想要自定义颜色，请用 <b>「纯色」+ 色轮</b>：那是唯一吃自定义色相的模式，' +
        '轴灯和底灯会一起变成你选的颜色。';
      const retry = document.createElement("button");
      retry.className = "ltab";
      retry.style.cssText = "height:26px;padding:0 14px;font-size:12px;margin-left:10px";
      retry.textContent = "重新检测";
      retry.onclick = () => { S.ledState = "idle"; readLeds().then(() => buildDeco()); };
      box.appendChild(retry);
      strip.appendChild(box);
      return;
    }
    const t = document.createElement("span");
    t.className = "dt";
    const nDeco = S.leds.deco.length;
    const nKeys = Object.keys(S.leds.map).length;
    t.textContent = "灯珠 " + S.leds.count + " · 按键 " + nKeys + " · 装饰灯 " + nDeco;
    strip.appendChild(t);

    if (nDeco === 0) {
      const warn = document.createElement("div");
      warn.className = "decoWarn";
      warn.textContent = "固件里没有「不属于按键」的灯珠 —— 说明 24 颗底灯不在 RGB 链上（白色单色 LED，只能开关），软件无法改色。";
      strip.appendChild(warn);
      return;
    }
    S.leds.deco.forEach((idx) => {
      const d = document.createElement("div");
      d.className = "dled";
      d.dataset.idx = idx;
      d.title = "底灯 #" + idx + " · 左键上色 / 右键清除";
      const c = S.ledColorsD[idx];
      if (c) { d.classList.add("on"); d.style.background = c; }
      d.addEventListener("click", () => paintDeco(idx));
      d.addEventListener("contextmenu", (e) => { e.preventDefault(); clearDeco(idx); });
      strip.appendChild(d);
    });
    const all = document.createElement("button");
    all.className = "ltab";
    all.style.height = "26px";
    all.style.padding = "0 14px";
    all.style.fontSize = "12px";
    all.style.marginLeft = "8px";
    all.textContent = "整条上色";
    all.onclick = paintAllDeco;
    strip.appendChild(all);
  }

  function markDeco(idx, css) {
    const d = document.querySelector('.dled[data-idx="' + idx + '"]');
    if (!d) return;
    if (css) { d.classList.add("on"); d.style.background = css; }
    else { d.classList.remove("on"); d.style.background = ""; }
  }

  async function paintDeco(idx) {
    if (!S.light) return toast("未连接", "err");
    if (!(await ensureDirect())) return;
    const L = S.light;
    try {
      await fastSet(idx, L.hue, L.sat, L.val);
      const css = hsvCss(L.hue, L.sat, L.val);
      S.ledColorsD[idx] = css;
      markDeco(idx, css);
      scheduleSave();
    } catch (e) { toast("底灯写入失败：" + e.message, "err"); }
  }

  async function clearDeco(idx) {
    try { await fastSet(idx, 0, 0, 0); } catch (e) { return; }
    delete S.ledColorsD[idx];
    markDeco(idx, null);
    scheduleSave();
  }

  async function paintAllDeco() {
    if (!S.leds || !S.light) return toast("底灯数据还没读到", "err");
    if (!(await ensureDirect())) return;
    const L = S.light;
    const css = hsvCss(L.hue, L.sat, L.val);
    for (const idx of S.leds.deco) {
      try { await fastSet(idx, L.hue, L.sat, L.val); } catch (e) { break; }
      S.ledColorsD[idx] = css;
      markDeco(idx, css);
    }
    scheduleSave();
    toast("底灯已全部上色", "ok");
  }

  function setLightTab(tab) {
    S.lightTab = tab;
    $$("#lightTabs .ltab").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $("#hint").textContent = tab === "deco" ? "点下方灯珠给底灯逐颗上色，右键清除；「整条上色」一次刷满" : "左键点击键盘上的键逐键上色，右键清除";
    buildDeco();
    if (tab === "keys") startPreview();
    else { stopPreview(); clearPreview(); }
  }

  function renderEffects() {
    const box = $("#effects");
    if (!S.light) {
      box.innerHTML = '<div class="muted" style="grid-column:1/-1">未连接，或这个键盘没报灯效协议</div>';
      return;
    }
    const ids = S.light.supported.length ? S.light.supported : Object.keys(EFFECTS).map(Number);
    if (box.dataset.built !== String(ids.length)) {
      box.innerHTML = "";
      ids.forEach((id) => {
        const b = document.createElement("button");
        b.dataset.id = id;
        b.textContent = EFFECTS[id] || "效果 " + id;
        b.onclick = () => setMode(id);
        box.appendChild(b);
      });
      box.dataset.built = String(ids.length);
    }
    Array.from(box.children).forEach((b) => b.classList.toggle("active", Number(b.dataset.id) === S.light.id));
  }

  function renderLight() {
    const L = S.light;
    if (!L) {
      $("#ledInfo").textContent = "连接后可逐键上色";
      renderEffects();
      return;
    }
    $("#bright").max = L.max;
    $("#bright").value = L.val;
    $("#lbBright").textContent = L.val + " / " + L.max;
    $("#speed").value = L.speed;
    $("#lbSpeed").textContent = L.speed;
    const hexv = hsvToHex(L.hue, L.sat, L.val);
    $("#hexIn").value = hexv.toUpperCase();
    const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(hsvCss(L.hue, L.sat, L.val));
    $("#rgbR").value = m[1]; $("#rgbG").value = m[2]; $("#rgbB").value = m[3];
    updateLedInfo();
    const hueDeg = (L.hue / 255) * 360;
    const rad = (hueDeg - 90) * Math.PI / 180;
    const rr = (L.sat / 255) * 48;
    $("#wCursor").style.left = 50 + Math.cos(rad) * rr + "%";
    $("#wCursor").style.top = 50 + Math.sin(rad) * rr + "%";
    $("#valbar").value = L.val;
    $("#valbar").style.background = "linear-gradient(90deg,#000,hsl(" + Math.round(hueDeg) + ",100%,50%))";
    renderEffects();
  }

  function updateLedInfo() {
    const el = $("#ledInfo");
    if (!S.leds) { el.textContent = "逐键灯效：不可用"; return; }
    el.innerHTML = "逐键灯效：已就绪<br>灯珠 " + S.leds.count + " 颗 · 按键 " +
      Object.keys(S.leds.map).length + " 颗 · 装饰灯 " + S.leds.deco.length + " 颗<br>" +
      "左键上色 · 右键清除";
  }

  /* ================= 高级键（Tap Dance / Combo / Key Override / Alt Repeat） ================= */
  const ADV_META = {
    td:    { get: 0x01, set: 0x02, size: 10, name: "Tap Dance" },
    combo: { get: 0x03, set: 0x04, size: 10, name: "组合键" },
    ko:    { get: 0x05, set: 0x06, size: 10, name: "键改写" },
    arep:  { get: 0x07, set: 0x08, size: 6,  name: "重复键" },
  };
  const ADV_COLS = {
    td:    ["点按", "长按", "双击", "点按长按", "判定ms"],
    combo: ["键1", "键2", "键3", "键4", "输出"],
    ko:    ["触发键", "替换成", "层掩码", "需要修饰", "屏蔽修饰", "选项"],
    arep:  ["原键", "替换为", "允许修饰", "选项"],
  };
  const ADV_TIP = "　左键格子选键码 · 右键格子清空为「无」";
  const ADV_DESC = {
    td: "点一下=点按键，长按=长按键，双击=双击，点按长按=双击后按住。判定ms 留 0 用全局设置。",
    combo: "同时按下这几个键触发「输出」键。没用的槽位填「无」。",
    ko: "按下「触发键」时改发「替换成」，可限定层与修饰键。选项里 128=启用。",
    arep: "按下「原键」后再按同一个键，会改发「替换为」。选项里 8=启用、1=默认、2=双向。",
  };

  const adv = { counts: { td: 0, combo: 0, ko: 0, arep: 0 }, data: {}, kind: "td" };

  const u16 = (b0, b1) => (b0 | (b1 << 8)) & 0xffff;

  async function advReadCounts() {
    try {
      const r = await xfer([0xfe, 0x0d, 0x00], 1200);
      adv.rawCounts = Array.from(r.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
      adv.counts.td = r[0];
      adv.counts.combo = r[1];
      adv.counts.ko = r[2];
      adv.counts.arep = r[3];
      S.capsWord = !!(r[31] & 1);
      S.layerLock = !!(r[31] & 2);
      diag("高级键能力: " + adv.rawCounts + " … flags=" + r[31]);
    } catch (e) {
      adv.rawCounts = "超时: " + e.message;
      diag("高级键数量读取失败: " + e.message);
      adv.counts = { td: 0, combo: 0, ko: 0, arep: 0 };
    }
  }

  async function advRead(kind, idx) {
    const meta = ADV_META[kind];
    const r = await xfer([0xfe, 0x0d, meta.get, idx], 700);
    if (r[0] !== 0) return null;
    const d = r.slice(1, 1 + meta.size);
    if (kind === "td") return { onTap: u16(d[0], d[1]), onHold: u16(d[2], d[3]), onDt: u16(d[4], d[5]), onTh: u16(d[6], d[7]), term: u16(d[8], d[9]) };
    if (kind === "combo") return { k: [u16(d[0], d[1]), u16(d[2], d[3]), u16(d[4], d[5]), u16(d[6], d[7])], out: u16(d[8], d[9]) };
    if (kind === "ko") return { trigger: u16(d[0], d[1]), repl: u16(d[2], d[3]), layers: u16(d[4], d[5]), tmods: d[6], negmods: d[7], smods: d[8], opts: d[9] };
    return { kc: u16(d[0], d[1]), alt: u16(d[2], d[3]), allowed: d[4], opts: d[5] };
  }

  async function advWrite(kind, idx, obj) {
    const meta = ADV_META[kind];
    const put = (v) => [v & 0xff, (v >> 8) & 0xff];
    let bytes;
    if (kind === "td") bytes = [...put(obj.onTap), ...put(obj.onHold), ...put(obj.onDt), ...put(obj.onTh), ...put(obj.term)];
    else if (kind === "combo") bytes = [...put(obj.k[0]), ...put(obj.k[1]), ...put(obj.k[2]), ...put(obj.k[3]), ...put(obj.out)];
    else if (kind === "ko") bytes = [...put(obj.trigger), ...put(obj.repl), ...put(obj.layers), obj.tmods, obj.negmods, obj.smods, obj.opts];
    else bytes = [...put(obj.kc), ...put(obj.alt), obj.allowed, obj.opts];
    await xfer([0xfe, 0x0d, meta.set, idx, ...bytes], 900);
  }

  async function advProbe(kind, maxN) {
    const out = [];
    for (let i = 0; i < maxN; i++) {
      let e = null;
      try { e = await advRead(kind, i); } catch (err) { e = null; }
      if (!e) break;
      out.push(e);
    }
    return out;
  }

  async function advLoad() {
    const kind = adv.kind;
    let n = adv.counts[kind] || 0;
    let rows = [];
    if (n > 0) {
      for (let i = 0; i < n; i++) {
        try { rows.push(await advRead(kind, i)); } catch (e) { rows.push(null); }
      }
    }
    if (!rows.length || rows.every((x) => !x)) {
      // 数量读不到时，直接逐条探测
      setConn("探测高级键…", "busy");
      rows = await advProbe(kind, 16);
      if (rows.length) {
        adv.counts[kind] = rows.length;
        diag("探测到 " + ADV_META[kind].name + " " + rows.length + " 条");
      }
      if (S.on) setConn("已连接 · " + (S.dev.productName || "imk60"), "on");
    }
    adv.data[kind] = rows;
    renderAdv();
  }

  function cellBtn(text, onclick, onClear) {
    const b = document.createElement("div");
    b.className = "advCell" + (text ? "" : " empty");
    b.textContent = text || "—";
    b.onclick = onclick;
    if (onClear) {
      b.title = "左键选择键码 · 右键清空为「无」";
      b.addEventListener("contextmenu", (e) => { e.preventDefault(); onClear(); });
    }
    return b;
  }

  async function setAdvField(kind, i, field, code) {
    const entry = (adv.data[kind] || [])[i];
    if (!entry) return;
    if (field.startsWith("k")) entry.k[Number(field.slice(1))] = code;
    else entry[field] = code;
    try {
      await advWrite(kind, i, entry);
      toast(code === 0 ? "已清空" : "已写入 " + kcOf(code).t, "ok");
    } catch (e) {
      toast("写入失败：" + e.message, "err");
    }
    renderAdv();
  }

  function numInput(val, max, onchange) {
    const inp = document.createElement("input");
    inp.className = "advNum";
    inp.type = "number";
    inp.min = "0";
    inp.max = String(max);
    inp.value = val;
    inp.onchange = () => onchange(Math.max(0, Math.min(max, Number(inp.value) || 0)));
    return inp;
  }

  function renderAdv() {
    const kind = adv.kind;
    const box = $("#advTable");
    const rows = adv.data[kind] || [];
    box.innerHTML = "";
    const raw = adv.rawCounts ? "　·　能力响应 " + adv.rawCounts : "";
    $("#advHint").textContent = ADV_DESC[kind] + ADV_TIP + "　（共 " + (adv.counts[kind] || 0) + " 条）" + raw;
    $$("#advTabs .ltab").forEach((b) => b.classList.toggle("active", b.dataset.kind === kind));

    if (!S.on) {
      box.innerHTML = '<div class="muted">连接键盘后读取</div>';
      return;
    }
    if (!rows.length) {
      box.innerHTML = '<div class="muted">没读到条目 —— 能力响应：' + (adv.rawCounts || "无") + '</div>';
      const retry = document.createElement("button");
      retry.className = "ltab";
      retry.style.cssText = "height:30px;padding:0 16px;font-size:12.5px;margin-top:10px";
      retry.textContent = "重新读取";
      retry.onclick = () => { adv.loaded = false; enterAdvanced(); };
      box.appendChild(retry);
      return;
    }

    const cols = ADV_COLS[kind];
    const head = document.createElement("div");
    head.className = "advRow advHead";
    head.style.gridTemplateColumns = "44px repeat(" + cols.length + ", 1fr)";
    head.innerHTML = "<div>#</div>" + cols.map((c) => "<div>" + c + "</div>").join("");
    box.appendChild(head);

    rows.forEach((entry, i) => {
      const row = document.createElement("div");
      row.className = "advRow";
      row.style.gridTemplateColumns = "44px repeat(" + cols.length + ", 1fr)";
      const id = document.createElement("div");
      id.className = "idx";
      id.textContent = "L" + i;
      row.appendChild(id);
      if (!entry) {
        row.appendChild(cellBtn("读取失败", () => {}));
        box.appendChild(row);
        return;
      }
      const kcCell = (val, field, label) => cellBtn(
        label,
        () => openKcPicker(kind, i, field, val),
        () => setAdvField(kind, i, field, 0)
      );
      const commit = () => advWrite(kind, i, entry).catch((e) => toast("写入失败：" + e.message, "err"));

      if (kind === "td") {
        row.appendChild(kcCell(entry.onTap, "onTap", kcOf(entry.onTap).t));
        row.appendChild(kcCell(entry.onHold, "onHold", kcOf(entry.onHold).t));
        row.appendChild(kcCell(entry.onDt, "onDt", kcOf(entry.onDt).t));
        row.appendChild(kcCell(entry.onTh, "onTh", kcOf(entry.onTh).t));
        row.appendChild(numInput(entry.term, 65535, (v) => { entry.term = v; commit(); }));
      } else if (kind === "combo") {
        for (let j = 0; j < 4; j++) row.appendChild(kcCell(entry.k[j], "k" + j, kcOf(entry.k[j]).t));
        row.appendChild(kcCell(entry.out, "out", kcOf(entry.out).t));
      } else if (kind === "ko") {
        row.appendChild(kcCell(entry.trigger, "trigger", kcOf(entry.trigger).t));
        row.appendChild(kcCell(entry.repl, "repl", kcOf(entry.repl).t));
        row.appendChild(numInput(entry.layers, 65535, (v) => { entry.layers = v; commit(); }));
        row.appendChild(numInput(entry.tmods, 255, (v) => { entry.tmods = v; commit(); }));
        row.appendChild(numInput(entry.smods, 255, (v) => { entry.smods = v; commit(); }));
        row.appendChild(numInput(entry.opts, 255, (v) => { entry.opts = v; commit(); }));
      } else {
        row.appendChild(kcCell(entry.kc, "kc", kcOf(entry.kc).t));
        row.appendChild(kcCell(entry.alt, "alt", kcOf(entry.alt).t));
        row.appendChild(numInput(entry.allowed, 255, (v) => { entry.allowed = v; commit(); }));
        row.appendChild(numInput(entry.opts, 255, (v) => { entry.opts = v; commit(); }));
      }
      box.appendChild(row);
    });
  }

  /* 键码弹窗 */
  let kcTarget = null;
  let kcCat = "基础";
  let kcQuery = "";

  function openKcPicker(kind, idx, field, current) {
    kcTarget = { kind, idx, field };
    $("#kcModalTitle").textContent = ADV_META[kind].name + " · L" + idx + " · 当前 " + kcOf(current).t + " (" + hx(current) + ")";
    $("#kcModal").hidden = false;
    renderKcCats();
    renderKcGrid();
  }
  function closeKcPicker() { $("#kcModal").hidden = true; kcTarget = null; }

  function renderKcCats() {
    const box = $("#kcCats");
    box.innerHTML = "";
    (window.KC_GROUPS || []).forEach((g) => {
      const b = document.createElement("button");
      b.textContent = g;
      if (g === kcCat && !kcQuery) b.classList.add("active");
      b.onclick = () => { kcCat = g; kcQuery = ""; $("#kcSearch").value = ""; renderKcCats(); renderKcGrid(); };
      box.appendChild(b);
    });
  }

  function renderKcGrid() {
    const grid = $("#kcGrid");
    grid.innerHTML = "";
    const q = kcQuery.trim().toLowerCase();
    let list = window.KEYCODES || [];
    if (q) {
      list = list.filter((k) => k.t.toLowerCase().includes(q) || (k.n && k.n.includes(q)) || hx(k.c).includes(q));
    } else {
      list = list.filter((k) => k.g === kcCat);
    }
    list.forEach((k) => {
      const d = document.createElement("div");
      d.className = "pk";
      d.innerHTML = '<div class="t"></div><div class="s"></div>';
      d.querySelector(".t").textContent = k.t;
      d.querySelector(".s").textContent = k.n || "";
      d.onclick = () => applyKcChoice(k.c);
      grid.appendChild(d);
    });
    if (!list.length) grid.innerHTML = '<div class="muted">没有匹配</div>';
  }

  async function applyKcChoice(code) {
    const t = kcTarget;
    if (!t) return;
    closeKcPicker();
    await setAdvField(t.kind, t.idx, t.field, code);
  }

  async function enterAdvanced() {
    if (!S.on) { renderAdv(); return; }
    if (!adv.loaded) {
      await advReadCounts();
      adv.loaded = true;
    }
    await advLoad();
  }

  /* ================= 蜂鸣器 ================= */
  async function readBuzzer() {
    const st = $("#buzzState");
    const rawBox = $("#buzzRaw");
    if (!S.on) {
      st.textContent = "未连接";
      st.className = "buzzState";
      $("#swAudio").disabled = true;
      $("#swClicky").disabled = true;
      return;
    }
    try {
      const a = await xfer([0x08, 0x04, 0x01], 700);
      const c = await xfer([0x08, 0x04, 0x02], 700);
      const onVal = a[3], clickyVal = c[3];
      $("#swAudio").checked = !!onVal;
      $("#swClicky").checked = !!clickyVal;
      $("#swAudio").disabled = false;
      $("#swClicky").disabled = false;
      rawBox.textContent = "音频通道原始值：enable=" + onVal + "  clicky=" + clickyVal;
      st.textContent = "已读取固件音频状态";
      st.className = "buzzState";
      S.audio = { supported: true };
      diag("蜂鸣器: enable=" + onVal + " clicky=" + clickyVal);
    } catch (e) {
      S.audio = { supported: false };
      $("#swAudio").disabled = true;
      $("#swClicky").disabled = true;
      rawBox.textContent = "音频通道无响应（" + e.message + "）";
      st.textContent = "⚠ 固件没有开放音频通道（未编译 AUDIO 的 VIA 接口），只能用键码开关。";
      st.className = "buzzState warn";
      diag("蜂鸣器读取失败: " + e.message);
    }
  }

  async function setBuzzer(field, val) {
    if (!S.on) return toast("还没连接键盘", "err");
    try {
      await xfer([0x07, 0x04, field, val ? 1 : 0], 700);
      toast(val ? "已开启" : "已关闭", "ok");
      setTimeout(readBuzzer, 120);
    } catch (e) {
      toast("写入失败：" + e.message, "err");
      readBuzzer();
    }
  }

  /* ================= 按键测试 ================= */
  function renderTestGrid() {
    const box = $("#testGrid");
    box.innerHTML = "";
    S.keys.forEach((k) => {
      const info = kcOf(kcAt(k.r, k.c), k.r, k.c);
      const d = document.createElement("div");
      d.className = "testCell";
      d.dataset.key = k.r + "," + k.c;
      d.textContent = info.t + "  " + k.r + "," + k.c;
      box.appendChild(d);
    });
  }

  function startTest() {
    stopTest();
    S.polling = true;
    const tick = async () => {
      if (!S.polling) return;
      try { highlight(await xfer([0x02, 0x03], 380)); } catch (e) { /* ignore */ }
      if (S.polling) setTimeout(tick, 60);
    };
    tick();
  }
  function stopTest() {
    S.polling = false;
    domSet.clear();
    $$(".key.pressed").forEach((el) => el.classList.remove("pressed"));
    $$(".testCell.on").forEach((el) => el.classList.remove("on"));
  }

  function onDomKey(e, down) {
    if (S.view !== "test") return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
    if (down) logEvent(e);
    domHighlight(CODE2KC[e.code], down);
  }
  document.addEventListener("keydown", (e) => onDomKey(e, true), true);
  document.addEventListener("keyup", (e) => onDomKey(e, false), true);
  window.addEventListener("blur", () => { domSet.clear(); $$(".key.pressed").forEach((el) => el.classList.remove("pressed")); });
  const domSet = new Set();
  const CODE2KC = {};
  for (let i = 0; i < 26; i++) CODE2KC["Key" + String.fromCharCode(65 + i)] = 0x04 + i;
  for (let i = 0; i < 10; i++) CODE2KC["Digit" + ((i + 1) % 10)] = 0x1e + i;
  Object.assign(CODE2KC, {
    Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Enter: 0x28,
    ShiftLeft: 0xe1, ShiftRight: 0xe5, ControlLeft: 0xe0, ControlRight: 0xe4,
    AltLeft: 0xe2, AltRight: 0xe6, MetaLeft: 0xe3, MetaRight: 0xe7, CapsLock: 0x39,
    Minus: 0x2d, Equal: 0x2e, BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31,
    Semicolon: 0x33, Quote: 0x34, Backquote: 0x35, Comma: 0x36, Period: 0x37, Slash: 0x38,
    ArrowUp: 0x52, ArrowDown: 0x51, ArrowLeft: 0x50, ArrowRight: 0x4f,
    Delete: 0x4c, Home: 0x4a, End: 0x4d, PageUp: 0x4b, PageDown: 0x4e, Insert: 0x49,
  });
  for (let i = 1; i <= 12; i++) CODE2KC["F" + i] = 0x3a + i - 1;

  function setKeyPressed(r, c, on) {
    const el = document.querySelector('.key[data-r="' + r + '"][data-c="' + c + '"]');
    if (el) el.classList.toggle("pressed", on);
    const cell = document.querySelector('.testCell[data-key="' + r + "," + c + '"]');
    if (cell) cell.classList.toggle("on", on);
  }

  function domHighlight(kc, down) {
    if (kc === undefined) return;
    S.keys.forEach((k) => {
      if (kcAt(k.r, k.c) === kc) {
        const key = k.r + "," + k.c;
        if (down) domSet.add(key); else domSet.delete(key);
        setKeyPressed(k.r, k.c, down);
      }
    });
  }

  function logEvent(e) {
    const box = $("#eventLog");
    const row = document.createElement("div");
    row.className = "ev";
    const b = document.createElement("b");
    b.textContent = e.key === " " ? "Space" : e.key;
    const sp = document.createElement("span");
    sp.textContent = e.code || "";
    const it = document.createElement("i");
    it.textContent = String(e.keyCode || "");
    row.appendChild(b); row.appendChild(sp); row.appendChild(it);
    box.prepend(row);
    while (box.children.length > 12) box.lastChild.remove();
    $("#evHint").textContent = "共 " + (box.children.length) + " 条";
  }

  function highlight(resp) {
    const bpr = Math.ceil(S.cols / 8);
    const pressed = new Set(domSet);
    let bits = 0;
    for (let r = 0; r < S.rows; r++) {
      for (let b = 0; b < bpr; b++) {
        const byte = resp[2 + r * bpr + b];
        if (!byte) continue;
        bits += 1;
        for (let bit = 0; bit < 8; bit++) {
          const c = b * 8 + bit;
          if (c < S.cols && (byte & (1 << bit))) pressed.add(r + "," + c);
          }
      }
    }
    $$(".key").forEach((el) => el.classList.toggle("pressed", pressed.has(el.dataset.r + "," + el.dataset.c)));
    $$(".testCell").forEach((el) => el.classList.toggle("on", pressed.has(el.dataset.key)));
    const raw = Array.from(resp.slice(0, 12)).map((b) => b.toString(16).padStart(2, "0")).join(" ");
    $("#rawLine").textContent = "矩阵原始：" + raw + "（非零字节 " + bits + " 个）";
  }

  /* ================= 备份 ================= */
  function snapshot() {
    const layers = {};
    Object.keys(S.km).forEach((l) => { layers[l] = Array.from(S.km[l]); });
    return {
      ts: new Date().toISOString(),
      name: S.def && S.def.name,
      rows: S.rows, cols: S.cols, layers: S.layers,
      keymap: layers,
      light: S.light ? { id: S.light.id, speed: S.light.speed, hue: S.light.hue, sat: S.light.sat, val: S.light.val } : null,
    };
  }

  async function backup(silent) {
    if (!S.on) return toast("还没连接键盘", "err");
    const snap = snapshot();
    localStorage.setItem("imk60.backup", JSON.stringify(snap));
    let file = "本地";
    try {
      const res = await fetch("/backup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snap),
      });
      const js = await res.json();
      if (js.file) file = js.file;
    } catch (e) { /* 本地已存 */ }
    $("#backupInfo").textContent = "最近备份：" + file + "\n时间：" + snap.ts.slice(0, 19).replace("T", " ");
    if (!silent) toast("已备份", "ok");
  }

  async function restore() {
    if (!S.on) return toast("还没连接键盘", "err");
    let snap = null;
    try {
      const res = await fetch("/backup/last");
      if (res.ok) snap = await res.json();
    } catch (e) { /* ignore */ }
    if (!snap) {
      const raw = localStorage.getItem("imk60.backup");
      if (raw) snap = JSON.parse(raw);
    }
    if (!snap) return toast("没有可用备份", "err");
    if (!confirm("用 " + String(snap.ts).slice(0, 19).replace("T", " ") + " 的备份覆盖键盘？")) return;

    setConn("恢复中…", "busy");
    try {
      const per = S.rows * S.cols;
      for (const l of Object.keys(snap.keymap)) {
        const kcs = snap.keymap[l];
        for (let i = 0; i < per; i += 14) {
          const chunk = [];
          for (let j = i; j < Math.min(i + 14, per); j++) {
            const kc = kcs[j] || 0;
            chunk.push((kc >> 8) & 0xff, kc & 0xff);
          }
          const off = Number(l) * per * 2 + i * 2;
          await xfer([0x13, (off >> 8) & 0xff, off & 0xff, chunk.length, ...chunk]);
        }
      }
      await readAll();
      renderBoard(); renderTestGrid();
      toast("已恢复", "ok");
      setConn("已连接", "on");
    } catch (e) {
      toast("恢复失败：" + e.message, "err");
      setConn("已连接", "on");
    }
  }

  /* ================= 视图 ================= */
  const VIEWS = { keymap: "viewKeymap", advanced: "viewAdvanced", light: "viewLight", buzzer: "viewBuzzer", test: "viewTest", backup: "viewBackup" };
  function setView(v) {
    S.view = v;
    $$(".nav").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
    Object.keys(VIEWS).forEach((k) => { $("#" + VIEWS[k]).hidden = k !== v; });
    const hideBoard = (v === "buzzer" || v === "backup");
    document.querySelector(".canvasCard").hidden = hideBoard;
    $("#hint").hidden = hideBoard;
    $("#hint").textContent =
      v === "keymap" ? "点键盘上的键，在下方选择新键码；也可以把键码拖到键上交换" :
      v === "light" ? "左键点击键盘上的键逐键上色，右键清除" :
      v === "test" ? "按下键盘上的键，上方会实时高亮" :
      "连接键盘时自动备份，可随时恢复";
    renderRail();
    renderBoard();
    if (v === "keymap") { renderSelChip(); renderPicker(); }
    if (v === "advanced") { enterAdvanced(); }
    if (v === "buzzer") { readBuzzer(); }
    if (v === "light") {
      renderLight();
      buildDeco();
      if (S.lightTab === "keys") startPreview();
      if (S.on && !S.leds) readLeds().then(() => { S.leds && updateLedInfo(); buildDeco(); });
    } else {
      stopPreview();
      const strip = $("#decoStrip");
      if (strip) strip.hidden = true;
    }
    if (v === "test") { renderTestGrid(); startTest(); } else stopTest();
  }

  function enterApp() {
    $("#home").hidden = true;
    $(".shell").hidden = false;
    computeUnit();
    renderRail();
    renderBoard();
    renderSelChip();
    renderPicker();
    renderTestGrid();
  }

  function backHome() {
    $("#home").hidden = false;
    $(".shell").hidden = true;
    $("#devTag").textContent = S.on ? "已连接 · 点此进入" : "立即连接";
    $("#devTag").className = "devTag" + (S.on ? " on" : "");
  }

  /* ================= 连接 ================= */
  async function connect() {
    if (!("hid" in navigator)) return toast("这个浏览器不支持 WebHID，请用 Chrome / Edge", "err");
    const tag = $("#devTag");
    if (tag) { tag.textContent = "选择设备…"; tag.className = "devTag busy"; }
    try {
      const picked = await navigator.hid.requestDevice({ filters: [{ usagePage: 0xff60, usage: 0x61 }] });
      if (!picked || !picked.length) {
        if (tag) { tag.textContent = "立即连接"; tag.className = "devTag"; }
        return;
      }
      S.dev = picked[0];
      await S.dev.open();
    } catch (e) {
      setConn("连接失败", "err");
      if (tag) { tag.textContent = "立即连接"; tag.className = "devTag"; }
      return toast("打开失败：" + e.message, "err");
    }

    setConn("握手中…", "busy");
    diag("设备 " + S.dev.productName + " " + S.dev.vendorId.toString(16) + ":" + S.dev.productId.toString(16));
    try {
      diag("VIA " + hex((await xfer([0x01])).slice(0, 4)));
      const fid = await xfer([0xfe, 0x00]);
      const vial = fid[0] | (fid[1] << 8) | (fid[2] << 16) | (fid[3] << 24);
      diag("Vial " + vial + " UID " + hex(fid.slice(4, 12)));

      const sz = await xfer([0xfe, 0x01]);
      const defSize = sz[0] | (sz[1] << 8) | (sz[2] << 16) | (sz[3] << 24);
      if (defSize !== CFG.defSize) toast("固件定义大小变了（" + defSize + "），建议重跑探针", "err");

      await readAll();
      S.on = true; S.cur = 0;
      renderRail(); renderBoard(); renderSelChip(); renderPicker(); renderTestGrid();
      setConn("已连接 · " + (S.dev.productName || "imk60"), "on");
      $("#btnConnect").textContent = "已连接";
      $("#btnConnect").disabled = true;
      $("#btnBackup").disabled = false;
      $("#devTag").textContent = "已连接";
      $("#devTag").className = "devTag on";
      enterApp();

      S.light = await readLight();
      renderLight();
      readLeds().then(() => { updateLedInfo(); buildDeco(); });
      if (S.view === "light") startPreview();
      await backup(true);
      toast("读取完成，已自动备份", "ok");
    } catch (e) {
      setConn("握手失败", "err");
      diag("错误 " + e.message);
      toast("握手失败：" + e.message, "err");
    }
  }

  /* ================= 初始化 ================= */
  async function init() {
    try {
      S.def = await (await fetch("keyboard.json")).json();
    } catch (e) {
      return toast("读取 keyboard.json 失败", "err");
    }
    buildKeycodes(S.def);
    S.rows = (S.def.matrix && S.def.matrix.rows) || 5;
    S.cols = (S.def.matrix && S.def.matrix.cols) || 14;
    S.keys = parseLayout(S.def);

    renderTabs();
    backHome();
    computeUnit();
    renderRail(); renderBoard(); renderPicker(); renderSelChip(); renderTestGrid();

    $("#btnConnect").onclick = connect;
    $("#devCard").onclick = () => { if (S.on) enterApp(); else connect(); };
    $("#addCard").onclick = connect;
    $("#btnHome").onclick = backHome;
    $("#swAudio").onchange = (e) => setBuzzer(1, e.target.checked);
    $("#swClicky").onchange = (e) => setBuzzer(2, e.target.checked);
    $("#homeDiag2").onclick = () => { $("#diagBar").hidden = false; S.diag = true; };
    $("#homeHelp").onclick = () => toast("选择键盘 → 授权 → 自动备份 → 改键，改完即时生效", "ok");
    $("#btnBackup").onclick = () => backup(false);
    $("#btnRestore").onclick = restore;
    $("#btnDiag").onclick = () => { $("#diagBar").hidden = false; S.diag = true; };
    $("#btnDiagClose").onclick = () => { $("#diagBar").hidden = true; S.diag = false; };
    $("#btnClearLed").onclick = clearAllLeds;
    $$(".nav").forEach((b) => { b.onclick = () => setView(b.dataset.view); });
    $$("#lightTabs .ltab").forEach((b) => { b.onclick = () => setLightTab(b.dataset.tab); });
    $$("#advTabs .ltab").forEach((b) => {
      b.onclick = () => { adv.kind = b.dataset.kind; advLoad(); };
    });
    $("#kcModalClose").onclick = closeKcPicker;
    $("#kcModal").addEventListener("click", (e) => { if (e.target.id === "kcModal") closeKcPicker(); });
    $("#kcSearch").addEventListener("input", (e) => { kcQuery = e.target.value; renderKcCats(); renderKcGrid(); });

    /* 色轮 */
    const wheel = $("#wheel");
    let wheelDrag = false;
    function pickWheel(e) {
      if (!S.light) return;
      const r = wheel.getBoundingClientRect();
      const cx = r.width / 2, cy = r.height / 2;
      let dx = e.clientX - r.left - cx, dy = e.clientY - r.top - cy;
      const len = Math.hypot(dx, dy);
      const maxR = cx * 0.98;
      if (len > maxR) { dx = dx * maxR / len; dy = dy * maxR / len; }
      const dist = Math.min(1, Math.hypot(dx, dy) / maxR);
      let ang = Math.atan2(dy, dx) * 180 / Math.PI;
      ang = (ang + 360) % 360;
      S.light.hue = Math.round(((ang + 90) % 360) / 360 * 255);
      S.light.sat = Math.round(dist * 255);
      renderLight(); pushParams();
    }
    wheel.addEventListener("pointerdown", (e) => { wheelDrag = true; wheel.setPointerCapture(e.pointerId); pickWheel(e); });
    wheel.addEventListener("pointermove", (e) => { if (wheelDrag) pickWheel(e); });
    wheel.addEventListener("pointerup", () => { wheelDrag = false; });
    wheel.addEventListener("pointercancel", () => { wheelDrag = false; });

    $("#valbar").addEventListener("input", (e) => {
      if (!S.light) return;
      S.light.val = Number(e.target.value); renderLight(); pushParams();
    });
    $("#bright").addEventListener("input", (e) => {
      if (!S.light) return;
      S.light.val = Number(e.target.value); renderLight(); pushParams();
    });
    $("#speed").addEventListener("input", (e) => {
      if (!S.light) return;
      S.light.speed = Number(e.target.value); renderLight(); pushParams();
    });
    $("#hexIn").addEventListener("change", (e) => {
      const v = e.target.value.trim().replace("#", "");
      if (!/^[0-9a-fA-F]{6}$/.test(v) || !S.light) return renderLight();
      const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d) {
        if (mx === r) h = ((g - b) / d) % 6;
        else if (mx === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h = Math.round(((h * 60) + 360) % 360);
      }
      S.light.hue = Math.round((h / 360) * 255);
      S.light.sat = mx ? Math.round((d / mx) * 255) : 0;
      S.light.val = mx;
      renderLight(); pushParams();
    });

    const SW = ["#f43f5e", "#ef4444", "#22c55e", "#eab308", "#3b82f6", "#a855f7", "#06b6d4", "#ffffff"];
    const swBox = $("#swatches");
    SW.forEach((c) => {
      const d = document.createElement("div");
      d.className = "sw"; d.style.background = c;
      d.onclick = () => {
        const v = c.replace("#", "");
        const r = parseInt(v.slice(0, 2), 16), g = parseInt(v.slice(2, 4), 16), b = parseInt(v.slice(4, 6), 16);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d2 = mx - mn;
        let h = 0;
        if (d2) {
          if (mx === r) h = ((g - b) / d2) % 6;
          else if (mx === g) h = (b - r) / d2 + 2;
          else h = (r - g) / d2 + 4;
          h = Math.round(((h * 60) + 360) % 360);
        }
        if (!S.light) return;
        S.light.hue = Math.round((h / 360) * 255);
        S.light.sat = mx ? Math.round((d2 / mx) * 255) : 0;
        S.light.val = mx;
        renderLight(); pushParams();
      };
      swBox.appendChild(d);
    });

    let rt = null;
    window.addEventListener("resize", () => {
      clearTimeout(rt);
      rt = setTimeout(() => { computeUnit(); renderBoard(); }, 120);
    });

    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && S.undo.length && S.view === "keymap") {
        e.preventDefault();
        const u = S.undo.pop();
        S.cur = u.layer;
        applyKeycode(u.old, { r: u.r, c: u.c });
        renderRail();
      }
    });

    if (navigator.hid) {
      navigator.hid.addEventListener("disconnect", (e) => {
        if (S.dev && e.device === S.dev) {
          S.on = false; setConn("设备已断开", "err");
          toast("键盘断开了，重新插好后刷新页面", "err");
        }
      });
    }

    setConn("未连接", "");
    const startView = (location.hash || "").replace("#", "");
    setView(VIEWS[startView] ? startView : "keymap");
  }

  async function clearAllLeds() {
    if (!S.leds) return toast("还没有逐键灯效数据", "err");
    if (!(await ensureDirect())) return;
    const idxs = Object.values(S.leds.map);
    for (const i of idxs) { try { await fastSet(i, 0, 0, 0); } catch (e) { break; } }
    S.ledColors = {};
    $$(".key.painted").forEach((el) => el.classList.remove("painted"));
    scheduleSave();
    toast("已清除逐键颜色", "ok");
  }

  window.addEventListener("DOMContentLoaded", init);
})();
