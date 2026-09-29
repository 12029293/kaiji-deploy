/**
 * PowerShell / cmd 子进程封装：exec、runAs（UAC 提权）、退出码捕获。
 * 中文路径/输出约定：cmd 前置 chcp 65001，PowerShell 前置 OutputEncoding（ARCH 共享知识 #5）。
 */
import { spawn } from 'node:child_process'

export interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

export interface ExecOptions {
  timeoutMs?: number
}

const DEFAULT_TIMEOUT = 600_000

function spawnAwait(
  cmd: string,
  args: string[],
  timeoutMs: number,
  verbatim = false
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let settled = false
    // windowsVerbatimArguments=true 时 Node 不做 argv 转义，原样拼接命令行。
    // cmd.exe /c 依赖该行为：Node 默认转义会在内嵌双引号前插入反斜杠，
    // 导致 `"...\xxx.exe" /S /D=...` 被 cmd 误判为“不是内部或外部命令”。
    const child = spawn(cmd, args, {
      windowsHide: true,
      windowsVerbatimArguments: verbatim
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        child.kill()
        reject(new Error(`命令超时（${timeoutMs}ms）: ${cmd} ${args.join(' ')}`))
      }
    }, timeoutMs)

    child.stdout?.on('data', (d: Buffer) => {
      stdout += d.toString('utf-8')
    })
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8')
    })
    child.on('error', (err) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        reject(err)
      }
    })
    child.on('close', (code) => {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ code: code ?? -1, stdout, stderr })
      }
    })
  })
}

/** 执行 PowerShell 命令，返回退出码与输出 */
export async function execPS(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  const wrapped = `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${command}`
  return spawnAwait(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', wrapped],
    opts.timeoutMs ?? DEFAULT_TIMEOUT
  )
}

/**
 * 执行 cmd 命令（环境变量 %VAR% 会由 cmd 展开，reg add 等依赖此特性）。
 * 使用 windowsVerbatimArguments 原样传递命令行——`/s` + 字符串以 `chcp` 开头（非引号）
 * 的组合会让 cmd 保留内嵌双引号，从而正确解析含空格的安装路径（NSIS /D= 等）。
 */
export async function execCmd(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  return spawnAwait(
    'cmd.exe',
    ['/d', '/s', '/c', `chcp 65001>nul & ${command}`],
    opts.timeoutMs ?? DEFAULT_TIMEOUT,
    true
  )
}

/** UAC 提权执行（Start-Process -Verb RunAs），等待结束后返回 ExitCode */
export async function runAs(command: string, opts: ExecOptions = {}): Promise<ExecResult> {
  // 将目标命令包装为独立的 powershell 调用，经 UAC 弹窗后以管理员运行
  const inner = command.replace(/'/g, "''")
  const ps = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    `$p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-Command','${inner}'; exit $p.ExitCode`
  ].join(' ')
  return spawnAwait('powershell.exe', ps.split(' '), opts.timeoutMs ?? DEFAULT_TIMEOUT)
}

/** 当前进程是否具备管理员权限 */
export async function isElevated(): Promise<boolean> {
  try {
    const res = await execPS(
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      { timeoutMs: 30_000 }
    )
    return res.stdout.trim().toLowerCase() === 'true'
  } catch {
    return false
  }
}
