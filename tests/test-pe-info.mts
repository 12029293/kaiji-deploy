/**
 * PE 架构判定纯函数测试（v1.0.2 架构自检）：
 * 用固定字节构造 PE32+/PE32 头，校验 machine / 位数 / 最低子系统版本判定。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { bundleModule, makeTmpDir } from './helpers/bundle.mts'

const tmpOut = makeTmpDir('kd-pe-')
const entry = path.join(tmpOut, 'entry-pe.mts')
fs.writeFileSync(
  entry,
  `export { parsePeHeader, isWin10Compatible, describePe } from '${path
    .join(process.cwd(), 'src/main/utils/peInfo.ts')
    .replace(/\\/g, '/')}'`
)
const mod = await bundleModule(entry, { tmpOut, name: 'peInfo' })
const { parsePeHeader, isWin10Compatible, describePe } = await import(mod)

/** 构造最小 PE 缓冲：machine + optional magic + 子系统版本 + subsystem */
function makePe(opts: {
  machine: number
  magic: number
  majorSub: number
  minorSub: number
  subsystem: number
}): Buffer {
  const buf = Buffer.alloc(256)
  buf.writeUInt16LE(0x5a4d, 0x00) // MZ
  const eLfanew = 0x80
  buf.writeUInt32LE(eLfanew, 0x3c)
  buf.writeUInt32LE(0x00004550, eLfanew) // PE\0\0
  buf.writeUInt16LE(opts.machine, eLfanew + 4)
  const optOff = eLfanew + 24
  buf.writeUInt16LE(opts.magic, optOff)
  buf.writeUInt16LE(opts.majorSub, optOff + 48)
  buf.writeUInt16LE(opts.minorSub, optOff + 50)
  buf.writeUInt16LE(opts.subsystem, optOff + 68)
  return buf
}

test('PE32+ x64（AMD64）：machine 0x8664 / 64 位 / 最低子系统 6.1 → 兼容 Win10', () => {
  const info = parsePeHeader(
    makePe({ machine: 0x8664, magic: 0x20b, majorSub: 6, minorSub: 1, subsystem: 2 })
  )
  assert.ok(info)
  assert.equal(info.machine, 0x8664)
  assert.equal(info.archName, 'AMD64')
  assert.equal(info.is64, true)
  assert.equal(info.minSubsystem, '6.1')
  assert.equal(info.subsystem, 2)
  assert.equal(isWin10Compatible(info), true)
  assert.match(describePe(info), /AMD64/)
  assert.match(describePe(info), /兼容 Win10/)
})

test('PE32 x86（i386）：machine 0x14c / 非 64 位', () => {
  const info = parsePeHeader(
    makePe({ machine: 0x014c, magic: 0x10b, majorSub: 6, minorSub: 0, subsystem: 3 })
  )
  assert.ok(info)
  assert.equal(info.archName, 'i386')
  assert.equal(info.is64, false)
  assert.equal(info.minSubsystem, '6.0')
})

test('ARM64：machine 0xaa64 → 64 位 ARM64', () => {
  const info = parsePeHeader(
    makePe({ machine: 0xaa64, magic: 0x20b, majorSub: 6, minorSub: 1, subsystem: 2 })
  )
  assert.ok(info)
  assert.equal(info.archName, 'ARM64')
  assert.equal(info.is64, true)
})

test('非 PE 缓冲 / 过短缓冲 → null', () => {
  assert.equal(parsePeHeader(Buffer.alloc(256)), null, '非 MZ 应返回 null')
  assert.equal(parsePeHeader(Buffer.alloc(8)), null, '过短应返回 null')
})
