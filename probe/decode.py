#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把探针抓回来的 device_dump.json 解成明文 keyboard.json
- Vial 固件里的定义是 lzma 压缩的 JSON（util/vial_generate_definition.py）
- 只在本地解一次，之后整个前端只吃明文 JSON

用法: python decode.py [device_dump.json]
"""
import base64
import json
import lzma
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def try_decompress(raw: bytes):
    """依次尝试几种容器格式，返回 (text, how)"""
    attempts = []

    try:
        return lzma.decompress(raw).decode("utf-8"), "xz/auto"
    except Exception as exc:  # noqa: BLE001
        attempts.append("auto:%s" % exc)

    try:
        return lzma.decompress(raw, format=lzma.FORMAT_ALONE).decode("utf-8"), "alone"
    except Exception as exc:  # noqa: BLE001
        attempts.append("alone:%s" % exc)

    # 裸 LZMA1 流：dict_size 常见 8K/16K/32K/64K，逐个试
    for dict_size in (1 << 13, 1 << 14, 1 << 15, 1 << 16, 1 << 17, 1 << 20):
        try:
            dec = lzma.LZMADecompressor(format=lzma.FORMAT_RAW,
                                        filters=[{"id": lzma.FILTER_LZMA1, "dict_size": dict_size}])
            return dec.decompress(raw).decode("utf-8"), "raw-LZMA1/0x%x" % dict_size
        except Exception as exc:  # noqa: BLE001
            attempts.append("raw0x%x:%s" % (dict_size, exc))

    # 有可能固件没压缩，直接是 JSON
    try:
        text = raw.decode("utf-8")
        if text.lstrip().startswith("{"):
            return text, "plain-json"
    except Exception:  # noqa: BLE001
        pass

    raise SystemExit("解压失败，尝试记录：\n  " + "\n  ".join(attempts[:6]))


def summarise(defn):
    lines = []
    name = defn.get("name", "?")
    vendor = defn.get("vendorId", "?")
    prod = defn.get("productId", "?")
    lines.append("键盘名称 : %s" % name)
    lines.append("VID/PID  : %s / %s" % (vendor, prod))

    matrix = defn.get("matrix") or {}
    rows, cols = matrix.get("rows"), matrix.get("cols")
    lines.append("矩阵     : %s 行 x %s 列" % (rows, cols))

    layouts = defn.get("layouts") or {}
    keymap = layouts.get("keymap") or []
    nkeys = 0
    for row in keymap:
        for k in row:
            if isinstance(k, (str, dict)) and k not in ("",):
                nkeys += 1
    lines.append("布局行数 : %d（键位数约 %d）" % (len(keymap), nkeys))
    if layouts.get("labels"):
        lines.append("布局选项 : %s" % ", ".join(str(x) for x in layouts["labels"]))

    lighting = defn.get("lighting")
    lines.append("灯效     : %s" % (lighting if not isinstance(lighting, dict) else
                                 "custom(%s)" % ",".join(lighting.keys())))

    if "encoders" in defn:
        lines.append("编码器   : %s" % defn["encoders"])
    if "customKeycodes" in defn:
        lines.append("自定义键 : %d 个" % len(defn["customKeycodes"]))

    if rows and cols:
        lines.append("层数上限 : 由固件动态键位区决定（探针已记 layerCountRaw）")
    return lines


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "device_dump.json")
    if not os.path.exists(path):
        raise SystemExit("找不到 %s —— 先跑探针页采集" % path)

    with open(path, "r", encoding="utf-8") as fh:
        dump = json.load(fh)

    vial = dump.get("vial") or {}
    b64 = vial.get("definitionBase64")
    if not b64:
        raise SystemExit("dump 里没有 definitionBase64，采集不完整")

    raw = base64.b64decode(b64)
    text, how = try_decompress(raw)
    defn = json.loads(text)

    out = os.path.join(ROOT, "keyboard.json")
    with open(out, "w", encoding="utf-8") as fh:
        json.dump(defn, fh, ensure_ascii=False, indent=2)

    print("=" * 52)
    print("压缩 %d bytes -> 明文 %d bytes（%s）" % (len(raw), len(text), how))
    print("已写出: %s" % out)
    print("-" * 52)
    for line in summarise(defn):
        print(line)
    print("=" * 52)

    print("\n探针原始信息：")
    print("  VIA 协议 raw : %s" % (dump.get("via", {}).get("protocolVersionRaw")))
    print("  Vial 协议    : %s" % vial.get("protocolVersion"))
    print("  UID          : %s" % vial.get("keyboardUidHex"))
    print("  rgbFlag      : %s" % vial.get("rgbFlagByte12"))
    print("  层数 raw     : %s" % (dump.get("via", {}).get("layerCountRaw")))
    print("  矩阵状态 raw : %s" % (dump.get("via", {}).get("matrixStateRaw")))
    print("  键位缓冲     : %s" % json.dumps(dump.get("via", {}).get("keymapRaw"), ensure_ascii=False)[:300])
    print("  灯效探测     : %s" % json.dumps(dump.get("lighting"), ensure_ascii=False)[:400])


if __name__ == "__main__":
    main()
