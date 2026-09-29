/**
 * 图标转换脚本：将 AI 生成的 1024x1024 PNG 转为 electron-builder 用的多尺寸 icon.ico。
 * 格式策略（rcedit 安全）：16-48 尺寸用 BMP(DIB) 帧，256 用 PNG 帧（Windows 标准做法）。
 * 用法：node scripts/make-ico.mjs <source.png> <output.ico>
 */
import Jimp from 'jimp'
import fs from 'node:fs'

const [, , src, dest] = process.argv
if (!src || !dest) {
  console.error('用法: node scripts/make-ico.mjs <source.png> <output.ico>')
  process.exit(1)
}

const BMP_SIZES = [48, 32, 24, 16]
const PNG_SIZES = [256]

const image = await Jimp.read(src)

/** 32bit BGRA 自下而上 + AND 掩码的 DIB 帧 */
function bmpFrame(size) {
  const resized = image.clone().resize(size, size, Jimp.RESIZE_BICUBIC)
  const { data } = resized.bitmap
  const rowMask = (Math.floor((size + 7) / 8) + 3) & ~3
  const pixelDataSize = size * size * 4
  const maskSize = rowMask * size
  const buf = Buffer.alloc(40 + pixelDataSize + maskSize)
  buf.writeUInt32LE(40, 0) // BITMAPINFOHEADER.biSize
  buf.writeInt32LE(size, 4) // biWidth
  buf.writeInt32LE(size * 2, 8) // biHeight（XOR+AND 两倍高）
  buf.writeUInt16LE(1, 12) // biPlanes
  buf.writeUInt16LE(32, 14) // biBitCount
  buf.writeUInt32LE(0, 16) // BI_RGB
  buf.writeUInt32LE(pixelDataSize + maskSize, 20) // biSizeImage
  let o = 40
  for (let y = size - 1; y >= 0; y--) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      buf[o++] = data[i + 2]
      buf[o++] = data[i + 1]
      buf[o++] = data[i]
      buf[o++] = data[i + 3]
    }
  }
  // AND 掩码区保持全 0（alpha 生效）
  return buf
}

const frames = []
for (const size of PNG_SIZES) {
  const resized = image.clone().resize(size, size, Jimp.RESIZE_BICUBIC)
  const buf = await resized.getBufferAsync(Jimp.MIME_PNG)
  frames.push({ size, isPng: true, buf })
  console.log(`生成 ${size}x${size} PNG 帧（${buf.length} bytes）`)
}
for (const size of [...BMP_SIZES].sort((a, b) => b - a)) {
  const buf = bmpFrame(size)
  frames.push({ size, isPng: false, buf })
  console.log(`生成 ${size}x${size} BMP 帧（${buf.length} bytes）`)
}

// 组装 ICO
const count = frames.length
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(count, 4)

const entries = []
let offset = 6 + count * 16
for (const { size, buf } of frames) {
  const e = Buffer.alloc(16)
  e.writeUInt8(size >= 256 ? 0 : size, 0)
  e.writeUInt8(size >= 256 ? 0 : size, 1)
  e.writeUInt8(0, 2)
  e.writeUInt8(0, 3)
  e.writeUInt16LE(1, 4)
  e.writeUInt16LE(32, 6)
  e.writeUInt32LE(buf.length, 8)
  e.writeUInt32LE(offset, 12)
  offset += buf.length
  entries.push(e)
}

const ico = Buffer.concat([header, ...entries, ...frames.map((f) => f.buf)])
fs.writeFileSync(dest, ico)
console.log(`✅ 已生成 ${dest}（${ico.length} bytes，${count} 个尺寸）`)
