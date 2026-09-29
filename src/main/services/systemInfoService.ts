/**
 * 系统信息采集（v1.1.1，概览页 statcard 对齐概念稿）：
 * - 基础数据来自 Node os 模块（同步、零依赖）
 * - CPU 负载用 os.cpus() 双采样（150ms）
 * - Windows 版本名 / CPU 物理核数 / C 盘容量来自一次 PowerShell CIM 查询（失败静默降级为 null）
 */
import * as os from 'os'
import { execFile } from 'child_process'
import type { SystemInfo } from '@shared/types'

const GB = 1024 ** 3

/** 延时工具（CPU 采样窗口） */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function sampleCpuLoad(windowMs = 150): Promise<number | null> {
  return new Promise((resolve) => {
    const t0 = os.cpus()
    setTimeout(() => {
      const t1 = os.cpus()
      let idle = 0
      let total = 0
      for (let i = 0; i < t1.length && i < t0.length; i++) {
        const a = t0[i].times
        const b = t1[i].times
        const d = {
          user: b.user - a.user,
          nice: b.nice - a.nice,
          sys: b.sys - a.sys,
          idle: b.idle - a.idle,
          irq: b.irq - a.irq
        }
        const sum = Object.values(d).reduce((x, y) => x + y, 0)
        idle += d.idle
        total += sum
      }
      resolve(total > 0 ? Math.min(100, Math.round(((total - idle) / total) * 100)) : null)
    }, windowMs)
  })
}

/** PowerShell CIM 一次性查询：OS 显示名/版本、CPU 核心数、C 盘容量 */
interface PsProbe {
  osLabel: string | null
  displayVersion: string | null
  buildNumber: string | null
  cpuName: string | null
  cpuCores: number | null
  cpuClockGHz: number | null
  diskFreeGB: number | null
  diskTotalGB: number | null
}

function psProbe(): Promise<PsProbe> {
  const empty: PsProbe = {
    osLabel: null,
    displayVersion: null,
    buildNumber: null,
    cpuName: null,
    cpuCores: null,
    cpuClockGHz: null,
    diskFreeGB: null,
    diskTotalGB: null
  }
  return new Promise((resolve) => {
    // reg 读取 DisplayVersion（CIM 不带），PS 读其余
    const script = [
      '$ErrorActionPreference="SilentlyContinue"',
      '$cv=(Get-ItemProperty "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")',
      '$cpu=Get-CimInstance Win32_Processor | Select-Object -First 1',
      '$disk=Get-CimInstance Win32_LogicalDisk -Filter "DeviceID=\'C:\'"',
      '$os=Get-CimInstance Win32_OperatingSystem',
      '[pscustomobject]@{cap=$os.Caption;build=[string]$os.BuildNumber;dv=[string]$cv.DisplayVersion;',
      'name=$cpu.Name;cores=[int]$cpu.NumberOfCores;mhz=[int]$cpu.MaxClockSpeed;',
      'free=[double]$disk.FreeSpace;total=[double]$disk.Size} | ConvertTo-Json -Compress'
    ].join(';')
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 8000, windowsHide: true, encoding: 'utf8' },
      (err, stdout) => {
        if (err || !stdout) return resolve(empty)
        try {
          const j = JSON.parse(stdout) as Record<string, unknown>
          const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
          resolve({
            osLabel: typeof j.cap === 'string' && j.cap ? j.cap.replace(/^Microsoft /, '').trim() : null,
            displayVersion: typeof j.dv === 'string' && j.dv ? j.dv : null,
            buildNumber: typeof j.build === 'string' && j.build ? j.build : null,
            cpuName: typeof j.name === 'string' && j.name ? j.name.trim() : null,
            cpuCores: num(j.cores),
            cpuClockGHz: num(j.mhz) != null ? Math.round((num(j.mhz) as number) / 100) / 10 : null,
            diskFreeGB: num(j.free) != null ? Math.round((num(j.free) as number) / GB) : null,
            diskTotalGB: num(j.total) != null ? Math.round((num(j.total) as number) / GB) : null
          })
        } catch {
          resolve(empty)
        }
      }
    )
  })
}

export async function getSystemInfo(): Promise<SystemInfo> {
  const [probe, cpuLoad] = await Promise.all([psProbe(), sampleCpuLoad()])

  // Windows 11 的注册表 ProductName 常误写为 Windows 10，按 Build 号判定
  const buildNum = probe.buildNumber ? parseInt(probe.buildNumber, 10) : 0
  let osLabel = probe.osLabel ?? `${os.type()}`
  if (/Windows/i.test(osLabel)) {
    osLabel = buildNum >= 22000 ? 'Windows 11' : buildNum >= 10240 ? 'Windows 10' : osLabel
  }
  const osVersion = probe.displayVersion
    ? probe.buildNumber
      ? `${probe.displayVersion} · ${probe.buildNumber}`
      : probe.displayVersion
    : os.release()

  const memTotalGB = Math.round(os.totalmem() / GB)
  const memFreeGB = os.freemem() / GB
  const memUsedGB = Math.round((os.totalmem() - os.freemem()) / GB)
  const diskUsedPct =
    probe.diskTotalGB && probe.diskFreeGB != null && probe.diskTotalGB > 0
      ? Math.round(((probe.diskTotalGB - probe.diskFreeGB) / probe.diskTotalGB) * 100)
      : null

  return {
    os: `${os.type()} ${os.release()}`,
    arch: os.arch(),
    isAdmin: false, // 由调用方覆盖（isElevated 在 ipc 层）
    desktopPath: '', // 同上
    hostname: os.hostname(),
    osLabel,
    osVersion,
    cpuName: probe.cpuName ?? '—',
    cpuCores: probe.cpuCores,
    cpuThreads: os.cpus().length,
    cpuClockGHz: probe.cpuClockGHz,
    cpuLoad,
    memTotalGB,
    memUsedGB,
    diskFreeGB: probe.diskFreeGB,
    diskTotalGB: probe.diskTotalGB,
    diskUsedPct
  }
}
