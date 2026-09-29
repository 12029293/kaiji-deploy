# -*- coding: utf-8 -*-
"""
生成规范 ICO：16/20/24/32/48/64/128 帧用未压缩 32bpp BMP(DIB)，仅 256x256 用 PNG。
（PIL 的 save('ico') 会把所有帧都写成 PNG，而 Windows 只对 256 帧支持 PNG，
小帧 PNG 会导致 Explorer 小图标路径解码失败回退默认图。）

用法: python build_proper_ico.py <1024源图.png> <输出.ico>
"""
import struct
import sys
from io import BytesIO

from PIL import Image

SIZES = [16, 20, 24, 32, 48, 64, 128, 256]


def bmp_entry(im: Image.Image) -> bytes:
    """32bpp DIB 帧：BITMAPINFOHEADER + XOR(BGRA 自底向上) + AND 掩码(1bpp)"""
    w, h = im.size
    rgba = im.convert("RGBA").tobytes()          # 自顶向下 RGBA
    # XOR：BGRA、自底向上
    xor = bytearray(w * h * 4)
    for row in range(h):
        src = (h - 1 - row) * w * 4
        dst = row * w * 4
        line = rgba[src: src + w * 4]
        for i in range(w):
            r, g, b, a = line[i * 4: i * 4 + 4]
            xor[dst + i * 4: dst + i * 4 + 4] = bytes((b, g, r, a))
    # AND 掩码：1bpp，每行按 32 位对齐（32bpp 有 alpha，掩码全 0 即可，但必须存在）
    row_bytes = ((w + 31) // 32) * 4
    and_mask = bytes(row_bytes * h)

    bih = struct.pack(
        "<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, w * h * 4, 0, 0, 0, 0
    )
    return bih + bytes(xor) + and_mask


def main():
    src = sys.argv[1]
    dst = sys.argv[2]
    im = Image.open(src).convert("RGBA")

    frames = []
    for s in SIZES:
        f = im.resize((s, s), Image.LANCZOS)
        if s == 256:
            buf = BytesIO()
            f.save(buf, "PNG")
            data = buf.getvalue()
        else:
            data = bmp_entry(f)
        frames.append((s, data))

    header_size = 6 + 16 * len(frames)
    entries = b""
    body = b""
    offset = header_size
    for s, data in frames:
        b = 0 if s >= 256 else s
        entries += struct.pack("<BBBBHHII", b, b, 0, 0, 1, 32, len(data), offset)
        body += data
        offset += len(data)

    ico = struct.pack("<HHH", 0, 1, len(frames)) + entries + body
    open(dst, "wb").write(ico)
    print(f"OK {dst}  {len(ico)} 字节, {len(frames)} 帧 ({', '.join(str(s) for s in SIZES)})")


if __name__ == "__main__":
    main()
