# -*- coding: utf-8 -*-
"""
生成「开机部署助手」NSIS MUI2 安装向导所需的位图资产。

用法:
    python make-nsis-art.py <icon.png> <输出目录> [版本号]

产出（NSIS MUI2 固定尺寸要求）:
    <输出目录>/header.bmp   150 x 57   页头右侧 Logo（MUI_HEADERIMAGE_BITMAP）
    <输出目录>/welcome.bmp  164 x 314  欢迎页/完成页左侧竖版侧栏（MUI_WELCOMEFINISHPAGE_BITMAP）

均为 24 位 BI_RGB BMP（NSIS 兼容，无 RLE 压缩）。
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

# 与应用主界面一致的深色配色（dark navy + 青/靛渐变强调色）
BG_TOP = (11, 18, 32)        # #0B1220
BG_BOTTOM = (24, 34, 58)     # #18223A
ACCENT_A = (34, 211, 238)    # #22D3EE cyan
ACCENT_B = (99, 102, 241)    # #6366F1 indigo
TEXT_MAIN = (255, 255, 255)
TEXT_SUB = (148, 163, 184)   # #94A3B8

FONT_REG = r"C:\Windows\Fonts\msyh.ttc"
FONT_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"


def load_font(path: str, size: int):
    return ImageFont.truetype(path, size)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def vgradient(size, top, bottom):
    """垂直渐变底图"""
    w, h = size
    img = Image.new("RGB", size, top)
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.line([(0, y), (w, y)], fill=lerp(top, bottom, y / max(h - 1, 1)))
    return img


def paste_icon(base: Image.Image, icon: Image.Image, box: int, cx: int, y: int):
    """按透明通道粘贴图标（LANCZOS 缩放）"""
    ic = icon.resize((box, box), Image.LANCZOS).convert("RGBA")
    base.paste(ic, (cx - box // 2, y), ic)


def make_header(icon: Image.Image, out: Path):
    """150x57 页头 Logo：深底 + 图标 + 底部青→靛渐变细条"""
    w, h = 150, 57
    img = Image.new("RGB", (w, h), BG_TOP)
    d = ImageDraw.Draw(img)
    # 底部 5px 渐变条
    for x in range(w):
        d.line([(x, h - 5), (x, h - 1)], fill=lerp(ACCENT_A, ACCENT_B, x / (w - 1)))
    # 图标（右侧留白，左侧供 NSIS 页头文字使用）
    paste_icon(img, icon, 38, 42, 9)
    img.save(out / "header.bmp", format="BMP")
    return img.size


def make_welcome(icon: Image.Image, version: str, out: Path):
    """164x314 欢迎页侧栏：渐变竖版 + 图标 + 标题 + 特性列表"""
    w, h = 164, 314
    img = vgradient((w, h), BG_TOP, BG_BOTTOM)
    d = ImageDraw.Draw(img)

    # 顶部图标
    paste_icon(img, icon, 60, w // 2, 30)

    # 标题
    f_title = load_font(FONT_BOLD, 17)
    d.text((w // 2, 112), "开机部署助手", font=f_title, fill=TEXT_MAIN, anchor="mm")

    # 强调分隔线（青→靛）
    for i, x in enumerate(range(w // 2 - 40, w // 2 + 40)):
        d.line([(x, 132), (x, 135)], fill=lerp(ACCENT_A, ACCENT_B, i / 79))

    # 副标题
    f_sub = load_font(FONT_REG, 10)
    d.text((w // 2, 150), "一键完成装机部署", font=f_sub, fill=TEXT_SUB, anchor="mm")

    # 特性列表
    f_item = load_font(FONT_REG, 10)
    items = ["自动下载最新版本", "静默安装到指定磁盘", "创建桌面快捷方式"]
    y = 186
    for it in items:
        d.ellipse([22, y + 3, 27, y + 8], fill=ACCENT_A)
        d.text((36, y + 5), it, font=f_item, fill=TEXT_SUB, anchor="lm")
        y += 26

    # 底部版本号
    f_ver = load_font(FONT_REG, 9)
    d.text((w // 2, h - 22), f"v{version}", font=f_ver, fill=(100, 116, 139), anchor="mm")

    img.save(out / "welcome.bmp", format="BMP")
    return img.size


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    icon_path = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    version = sys.argv[3] if len(sys.argv) > 3 else "1.0.4"
    out_dir.mkdir(parents=True, exist_ok=True)

    icon = Image.open(icon_path).convert("RGBA")
    print("header :", make_header(icon, out_dir))
    print("welcome:", make_welcome(icon, version, out_dir))

    # 校验位深与尺寸（NSIS 要求）
    for name, exp in (("header.bmp", (150, 57)), ("welcome.bmp", (164, 314))):
        p = out_dir / name
        with Image.open(p) as im:
            assert im.size == exp, f"{name} 尺寸 {im.size} != {exp}"
            assert im.mode == "RGB", f"{name} mode={im.mode}"
        print(f"{name}: {exp[0]}x{exp[1]} 24bit OK -> {p}")


if __name__ == "__main__":
    main()
