/**
 * 图片元信息解析（v1.0.9 从 netbianService 抽出为公共工具）：
 * JPEG SOF / PNG IHDR 头部像素尺寸解析，供 netbian / wallhaven 落盘前校验复用。
 */

/**
 * JPEG SOF / PNG IHDR 像素解析（移植自侦察脚本 test-chain.js parsePixels）。
 * 解析失败返回 null。
 */
export function parsePixels(
  buf: Uint8Array
): { w: number; h: number; fmt: 'jpeg' | 'png' } | null {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf)
  if (b.length > 11 && b[0] === 0xff && b[1] === 0xd8) {
    let off = 2
    while (off < b.length - 9) {
      if (b[off] !== 0xff) {
        off++
        continue
      }
      const marker = b[off + 1]
      // SOF0~SOF15，排除 DHT(C4)/JPG(C8)/DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: b.readUInt16BE(off + 5), w: b.readUInt16BE(off + 7), fmt: 'jpeg' }
      }
      off += 2 + b.readUInt16BE(off + 2)
    }
  } else if (b.length > 24 && b.subarray(1, 4).toString('latin1') === 'PNG') {
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), fmt: 'png' }
  }
  return null
}
