/**
 * PE 头解析（纯读文件，不依赖外部工具）：判定可执行文件的 CPU 架构与最低子系统版本。
 * 回应“下载的到底是不是 Windows 10 / 64 位版本”这类问题（v1.0.2 架构自检）。
 *
 * PE 结构（偏移均为文件绝对偏移）：
 *   0x00  e_magic 'MZ'
 *   0x3C  e_lfanew（4B LE）→ PE 签名 'PE\0\0'
 *   e_lfanew+4        COFF Header.Machine（2B）
 *   e_lfanew+24       Optional Header.Magic（2B：0x10B=PE32 / 0x20B=PE32+）
 *   e_lfanew+24+48    MajorSubsystemVersion（2B）
 *   e_lfanew+24+50    MinorSubsystemVersion（2B）
 *   e_lfanew+24+68    Subsystem（2B）
 */
import fs from 'node:fs'

export interface PeInfo {
  /** 原始 Machine 常量 */
  machine: number
  /** AMD64 / i386 / ARM64 / ARM / 未知 */
  archName: string
  /** 是否 64 位（PE32+ 或 AMD64/ARM64） */
  is64: boolean
  /** 最低子系统版本，如 '6.1' */
  minSubsystem: string
  /** 子系统号（2=GUI，3=Console） */
  subsystem: number
}

const MACHINE_NAMES: Record<number, string> = {
  0x014c: 'i386',
  0x8664: 'AMD64',
  0xaa64: 'ARM64',
  0x01c0: 'ARM',
  0x01c4: 'ARMv7',
  0x0200: 'IA64'
}

/** 解析 PE 头（纯函数，接收已读入的缓冲）。非 PE 或数据不足返回 null。 */
export function parsePeHeader(buf: Buffer): PeInfo | null {
  if (buf.length < 0x40) return null
  if (buf.readUInt16LE(0x00) !== 0x5a4d) return null // 'MZ'
  const eLfanew = buf.readUInt32LE(0x3c)
  if (eLfanew <= 0 || eLfanew + 0x18 > buf.length) return null
  if (buf.readUInt32LE(eLfanew) !== 0x00004550) return null // 'PE\0\0'
  const machine = buf.readUInt16LE(eLfanew + 4)
  const optOff = eLfanew + 24
  if (optOff + 70 > buf.length) return null
  const optMagic = buf.readUInt16LE(optOff)
  const majorSub = buf.readUInt16LE(optOff + 48)
  const minorSub = buf.readUInt16LE(optOff + 50)
  const subsystem = buf.readUInt16LE(optOff + 68)
  const isPe32Plus = optMagic === 0x20b
  const is64 = isPe32Plus || machine === 0x8664 || machine === 0xaa64 || machine === 0x0200
  return {
    machine,
    archName: MACHINE_NAMES[machine] ?? `未知(0x${machine.toString(16)})`,
    is64,
    minSubsystem: `${majorSub}.${minorSub}`,
    subsystem
  }
}

/** Windows 10 兼容判定：最低子系统版本 < 10.0 即兼容（Vista=6.0 / Win7=6.1 / Win8=6.2 / Win8.1=6.3） */
export function isWin10Compatible(info: PeInfo): boolean {
  return Number(info.minSubsystem) < 10
}

/** 读取文件前若干字节并解析 PE 头。读不到 / 非 PE 返回 null（只 warn，不抛）。 */
export function readPeInfo(filePath: string): PeInfo | null {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const size = Math.min(fs.fstatSync(fd).size, 65536)
      const buf = Buffer.alloc(size)
      const read = fs.readSync(fd, buf, 0, size, 0)
      return parsePeHeader(buf.subarray(0, read))
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return null
  }
}

/** 一行人类可读描述，如 'AMD64 · 兼容 Win10（最低子系统 6.1）' */
export function describePe(info: PeInfo): string {
  const win10 = isWin10Compatible(info)
  return `${info.archName} · ${win10 ? '兼容 Win10' : `要求子系统 ${info.minSubsystem}+`}（最低子系统 ${info.minSubsystem}）`
}
