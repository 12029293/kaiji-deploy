/**
 * 统一安装引擎（配置驱动）：resolve → download → install → post → verify → 降级向导。
 * 引擎只认 InstallConfig，新增软件零引擎改动（ARCH §1.1 挑战 1）。
 * v1.0.2：zip 防御（非 exe/msi 不执行）、桌面快捷方式、开机启动门控、架构自检、多镜像下载。
 */
import { shell } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import type { InstallConfig, TaskState, TaskStatus } from '@shared/types'
import { logger } from '../core/logger'
import { settings } from '../core/settings'
import { execCmd, execPS, runAs } from '../core/shellRunner'
import { cachedPath, downloadToFile } from '../core/downloader'
import * as fsUtils from '../utils/fsUtils'
import { getAssetPath, getCacheDir, getDesktopPath, getInstallRoot } from '../config/paths'
import { appsResolvers } from '../config/apps.config'
import { devEnvResolvers } from '../config/devEnv.config'
import { resolveGithubAsset } from '../services/proxyService'
import { imeService } from '../services/imeService'
import * as shortcutService from '../services/shortcutService'

/** 解析器返回：目标 URL + 文件名；可选镜像候选与附加请求头（VLC 等反爬场景） */
export interface ResolverResult {
  url: string
  filename: string
  mirrors?: string[]
  headers?: Record<string, string>
}

export type ResolverFn = (proxyUrl: string | null) => Promise<ResolverResult>

/** 任务状态更新回调（由 TaskQueue 提供，负责状态落 Map + IPC 推送） */
export type UpdateFn = (patch: Partial<TaskState>) => void

/** 阶段一（解析+下载）结果 */
export type Phase1 =
  | { ok: true; filePath: string }
  | { ok: false; status: 'manual-needed' | 'failed'; message: string }

/** 阶段二结果：最终状态 + 附加说明（架构自检 / 快捷方式等，附到任务 message） */
export interface InstallOutcome {
  status: TaskStatus
  note?: string
}

/** 解析器注册表（apps + devEnv 合并；命名函数注册在 config 文件内，ARCH 共享知识 #9） */
export function getResolver(name: string): ResolverFn | undefined {
  return appsResolvers[name] ?? devEnvResolvers[name]
}

/** 从 URL 提取文件名 */
export function filenameFromUrl(url: string): string {
  try {
    const p = decodeURIComponent(new URL(url).pathname)
    const name = p.split('/').pop()
    return name && name.length > 0 ? name : 'download.bin'
  } catch {
    return 'download.bin'
  }
}

function destDirFor(cfg: InstallConfig): string {
  return cfg.downloadDir === 'desktop' ? getDesktopPath() : getCacheDir()
}

/** 打开官网/仓库页（降级 browser 用） */
async function openHomepage(cfg: InstallConfig): Promise<void> {
  const target =
    cfg.homepage ??
    (cfg.source.repo ? `https://github.com/${cfg.source.repo}/releases` : '')
  if (target) {
    logger.info('install', `${cfg.name} 打开官网: ${target}`)
    if (cfg.manualHint) logger.warn('install', `${cfg.name} ${cfg.manualHint}`)
    await shell.openExternal(target)
  } else {
    logger.warn('install', `${cfg.name} 无可用的降级 URL`)
  }
}

/** 组合降级原因 + 人工提示（如比特浏览器图形验证码） */
function withHint(cfg: InstallConfig, reason: string): string {
  return cfg.manualHint ? `${reason}（${cfg.manualHint}）` : reason
}

/**
 * 降级处理（P0-3）：wizard=打开本地安装包向导 / browser=打开官网 / none=仅标失败。
 * 返回最终任务状态。
 */
async function degradeAfterFailure(
  cfg: InstallConfig,
  reason: string,
  candidatePath?: string
): Promise<'manual-needed' | 'failed'> {
  logger.warn('install', `${cfg.name} ${reason}，降级策略: ${cfg.degrade}`)
  if (cfg.degrade === 'wizard') {
    // 引导器形态（向日葵）：静默参数被父进程拒绝，但安装器已自行拉起 GUI，
    // 此时再 openPath 会多弹一个安装窗口 → 仅标 manual-needed，不再打开（v1.0.2 修复）。
    if (cfg.wizardSelfLaunched) {
      logger.info(
        'install',
        `${cfg.name} 安装器自身已拉起 GUI（wizardSelfLaunched），不再额外打开安装包，标记为待人工完成`
      )
      if (cfg.manualHint) logger.warn('install', `${cfg.name} ${cfg.manualHint}`)
      return 'manual-needed'
    }
    const wizard = candidatePath ?? cfg.wizardPath
    if (wizard && fsUtils.existsSafe(wizard)) {
      logger.info('install', `${cfg.name} 打开安装向导: ${wizard}`)
      await shell.openPath(wizard)
      return 'manual-needed'
    }
    await openHomepage(cfg)
    return 'manual-needed'
  }
  if (cfg.degrade === 'browser') {
    await openHomepage(cfg)
    return 'manual-needed'
  }
  return 'failed'
}

/** 在常见安装目录按关键词查找已安装的 exe（set-autostart 用） */
function findExeByKeyword(keyword: string): string | null {
  if (!keyword) return null
  const roots = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : undefined
  ].filter((r): r is string => Boolean(r))
  const needle = keyword.toLowerCase()
  for (const root of roots) {
    try {
      // 根目录直属 exe
      for (const f of fs.readdirSync(root)) {
        const p = path.join(root, f)
        if (f.toLowerCase().endsWith('.exe') && f.toLowerCase().includes(needle)) return p
      }
      // 二级目录
      for (const d of fs.readdirSync(root)) {
        const dir = path.join(root, d)
        try {
          if (!fs.statSync(dir).isDirectory()) continue
          if (d.toLowerCase().includes(needle)) {
            for (const f of fs.readdirSync(dir)) {
              if (f.toLowerCase().endsWith('.exe')) return path.join(dir, f)
            }
          }
          for (const f of fs.readdirSync(dir)) {
            if (f.toLowerCase().endsWith('.exe') && f.toLowerCase().includes(needle)) {
              return path.join(dir, f)
            }
          }
        } catch {
          /* 无权限/占用目录跳过 */
        }
      }
    } catch {
      /* 目录不存在跳过 */
    }
  }
  return null
}

/* ---------------- 阶段一：解析 + 下载 ---------------- */

export async function resolveAndDownload(
  cfg: InstallConfig,
  update: UpdateFn
): Promise<Phase1> {
  const src = cfg.source
  const proxy = settings.proxyUrl()

  // 无自动安装源：直接开官网走手动
  if (src.kind === 'none') {
    await openHomepage(cfg)
    return {
      ok: false,
      status: 'manual-needed',
      message: '该软件无自动安装源，已打开官网，请手动下载安装'
    }
  }

  // 本地安装包（蓝山看图王 / IDM破解）
  if (src.kind === 'local-file') {
    const localPath = getAssetPath(src.localPath ?? '')
    if (!fsUtils.existsSafe(localPath)) {
      logger.error('install', `${cfg.name} 本地安装包不存在: ${localPath}`)
      return { ok: false, status: 'failed', message: `本地安装包不存在: ${localPath}` }
    }
    // 下载到桌面并重命名（IDM破解 P0-7）
    if (cfg.downloadDir === 'desktop') {
      const dest = path.join(getDesktopPath(), cfg.renameTo ?? path.basename(localPath))
      fsUtils.copySafe(localPath, dest)
      logger.info('install', `${cfg.name} 已复制到桌面: ${dest}`)
      return { ok: true, filePath: dest }
    }
    return { ok: true, filePath: localPath }
  }

  // 解析下载直链
  update({ status: 'checking', message: '解析下载地址' })
  let url = ''
  let filename = ''
  let mirrors: string[] | undefined
  let headers: Record<string, string> | undefined
  try {
    if (src.kind === 'direct-url') {
      url = src.url ?? ''
      if (!url) throw new Error('direct-url 配置缺少 url')
      filename = filenameFromUrl(url)
    } else if (src.kind === 'url-resolver') {
      const resolver = getResolver(src.resolver ?? '')
      if (!resolver) throw new Error(`未注册的解析器: ${src.resolver}`)
      const out = await resolver(proxy)
      url = out.url
      filename = out.filename
      mirrors = out.mirrors
      headers = out.headers
    } else if (src.kind === 'github-release') {
      if (!src.repo || !src.assetPattern) throw new Error('github-release 配置缺少 repo/assetPattern')
      const out = await resolveGithubAsset(src.repo, src.assetPattern, proxy)
      url = out.url
      filename = out.filename
    } else {
      throw new Error(`未知来源类型: ${String(src.kind)}`)
    }
    logger.info('install', `${cfg.name} 解析到下载地址: ${url}`)
  } catch (err) {
    const reason = `解析下载地址失败: ${err instanceof Error ? err.message : String(err)}`
    const status = await degradeAfterFailure(cfg, reason)
    return { ok: false, status, message: withHint(cfg, reason) }
  }

  // 下载（含缓存跳过 P2-2）：统一先落缓存目录，desktop 目标再复制重命名
  const finalName = cfg.renameTo ?? filename
  const cachePath = cachedPath(getCacheDir(), url, filename)
  let filePath = cachePath
  if (cfg.downloadDir === 'desktop') {
    filePath = path.join(getDesktopPath(), finalName)
  }
  update({ status: 'downloading', progress: 0, message: `下载 ${filename}` })
  try {
    const cacheHit = settings.get().cacheEnabled && fsUtils.existsSafe(cachePath)
    if (cacheHit) {
      logger.info('install', `${cfg.name} 命中本地缓存，跳过下载: ${cachePath}`)
    } else {
      await downloadToFile(url, cachePath, {
        proxy,
        mirrors,
        headers,
        onProgress: (p) => {
          update({
            progress: p.percent,
            message: `下载 ${filename} ${p.percent}%（${(p.received / 1024 / 1024).toFixed(1)}/${(p.total / 1024 / 1024).toFixed(1)} MB）`
          })
        }
      })
    }
    if (filePath !== cachePath) {
      fsUtils.copySafe(cachePath, filePath)
    }
  } catch (err) {
    const reason = `下载失败: ${err instanceof Error ? err.message : String(err)}`
    const status = await degradeAfterFailure(cfg, reason)
    return { ok: false, status, message: withHint(cfg, reason) }
  }
  return { ok: true, filePath }
}

/* ---------------- 阶段二：安装 + 后置动作 + 校验 ---------------- */

/**
 * 计算安装目标目录：
 * - 开发环境（devenv）保持安装器默认（C 盘），返回 null 不注入目录参数；
 * - 其余（daily/proxy）统一安装到 D:\Apps\<id>（id 全 ascii 无空格，兼容 NSIS /D 约束；
 *   机器无 D 盘时 getInstallRoot 自动回退 C:\Apps）。
 * 返回 null 表示不注入。
 */
export function getInstallDirFor(cfg: InstallConfig): string | null {
  if (cfg.category === 'devenv') return null
  return path.join(getInstallRoot(), cfg.id)
}

/**
 * 依据安装器参数风格拼接静默安装命令行（NSIS / Inno / MSI / 无参四路分流）。
 * - msi：`msiexec /i "<f>" <args> INSTALLDIR="<dir>" /norestart`
 * - nsis（默认）：`"<f>" <args> /D=<dir>`（/D= 必须最后且不加引号）
 * - inno：`"<f>" <args> /DIR="<dir>"`
 * - none / 无安装目录：`"<f>" <args>`
 * style 缺省时按扩展名（.msi）与参数（/VERYSILENT|/SILENT）自动判定。
 */
export function buildInstallCommand(
  filePath: string,
  args: string,
  installDir: string | null,
  style?: 'nsis' | 'inno' | 'msi' | 'none'
): string {
  const a = (args ?? '').trim()
  if (style === 'msi' || /\.msi$/i.test(filePath)) {
    // MSI：目录属性 INSTALLDIR（个别厂商 MSI 如 Chrome 会忽略，可接受）
    const dirArg = installDir ? ` INSTALLDIR="${installDir}"` : ''
    return `msiexec /i "${filePath}" ${a}${dirArg} /norestart`.trim()
  }
  if (style === 'none' || !installDir) {
    return `"${filePath}" ${a}`.trim()
  }
  // Inno Setup：/DIR="..."；NSIS：/D=<dir>
  if (style === 'inno' || /\/(verysilent|silent)\b/i.test(a)) {
    return `"${filePath}" ${a} /DIR="${installDir}"`.trim()
  }
  return `"${filePath}" ${a} /D=${installDir}`.trim()
}

export function buildSilentCommand(cfg: InstallConfig, filePath: string): string {
  return buildInstallCommand(filePath, cfg.silentArgs ?? '', getInstallDirFor(cfg))
}

/**
 * 在解压目标目录（含两层子目录，浅层优先）内查找 basename 匹配 pattern 的安装器 exe。
 * 用于「zip 里其实是安装器」（动漫共和国）的解压后自动安装。
 */
export function findExtractedInstaller(target: string, pattern: string): string | null {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    logger.warn('install', `内层安装器匹配正则非法: ${pattern}`)
    return null
  }
  const scan = (dir: string, depth: number): string | null => {
    if (depth > 2) return null
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    // 先扫当前层文件，保证浅层优先
    for (const e of entries) {
      if (e.isFile() && /\.exe$/i.test(e.name) && re.test(e.name)) return path.join(dir, e.name)
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        const hit = scan(path.join(dir, e.name), depth + 1)
        if (hit) return hit
      }
    }
    return null
  }
  return fsUtils.existsSafe(target) ? scan(target, 0) : null
}

async function runSilentInstall(cfg: InstallConfig, filePath: string): Promise<number> {
  // 防御：仅真正的安装器（exe/msi）才执行，绝不对 zip 等归档调用安装
  if (!/\.(exe|msi)$/i.test(filePath)) {
    logger.warn('install', `${cfg.name} 目标非安装器（${path.basename(filePath)}），跳过执行`)
    return 0
  }
  const cmd = buildSilentCommand(cfg, filePath)
  logger.info('install', `${cfg.name} 静默安装命令: ${cmd}`)
  const t0 = Date.now()
  const res = await execCmd(cmd, { timeoutMs: 30 * 60_000 })
  logger.info(
    'install',
    `${cfg.name} 安装退出码 ${res.code}（${((Date.now() - t0) / 1000).toFixed(1)}s）${res.stderr.trim() ? ` stderr: ${res.stderr.trim().slice(0, 300)}` : ''}`
  )
  return res.code
}

async function runPostActions(
  cfg: InstallConfig,
  update: UpdateFn,
  notes: string[],
  sinceMs?: number
): Promise<void> {
  for (const action of cfg.postActions ?? []) {
    if (action.type === 'set-autostart') {
      // v1.0.2：默认不设开机启动（settings.setAutostart 默认 false，由 UI 开关控制）
      if (settings.get().setAutostart !== true) {
        logger.warn('install', `${cfg.name} 未开启“设置开机启动”，跳过 Run 键写入`)
        continue
      }
      const keyword = action.runKey.replace(/[^a-zA-Z]/g, '').toLowerCase().slice(0, 6)
      const exe = findExeByKeyword(keyword)
      if (!exe) {
        logger.warn('install', `${cfg.name} 未能定位开机自启程序（关键词 ${keyword}），已跳过自启写入`)
        continue
      }
      const cmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${action.runKey}" /t REG_SZ /d "\\"${exe}\\"" /f`
      const res = await execCmd(cmd)
      logger.info(
        'install',
        `${cfg.name} 开机自启${res.code === 0 ? `已写入: ${exe}` : `写入失败（退出码 ${res.code}）`}`
      )
    } else if (action.type === 'cleanup-ime') {
      // P0-8 微信输入法：清理其他输入法（保留微信输入法 + 默认英文键盘）
      update({ status: 'installing', message: '正在清理其他输入法（保留微信输入法）' })
      await imeService.cleanup()
    } else if (action.type === 'add-path') {
      // FFmpeg 等 zip 免安装工具：把可执行目录加入系统 PATH（Machine 级，应用以管理员运行）
      let dir = action.dir
      if (!fsUtils.existsSafe(dir)) {
        const parent = path.dirname(dir)
        const leaf = path.basename(dir)
        try {
          const sub = fs
            .readdirSync(parent)
            .find((d) => fsUtils.existsSafe(path.join(parent, d, leaf)))
          if (sub) dir = path.join(parent, sub, leaf)
        } catch {
          /* 父目录不存在则保持原路径，下方统一告警 */
        }
      }
      if (!fsUtils.existsSafe(dir)) {
        logger.warn('install', `${cfg.name} add-path 目录不存在，已跳过: ${dir}`)
        continue
      }
      const esc = dir.replace(/'/g, "''")
      const res = await execPS(
        `$d='${esc}';$p=[Environment]::GetEnvironmentVariable('Path','Machine');if(($p -split ';') -notcontains $d){[Environment]::SetEnvironmentVariable('Path',($p.TrimEnd(';')+';'+$d),'Machine');Write-Output added}else{Write-Output exists}`,
        { timeoutMs: 60_000 }
      )
      logger.info(
        'install',
        `${cfg.name} PATH 追加${res.code === 0 ? `完成: ${dir}（${res.stdout.trim()}）` : `失败（退出码 ${res.code}）`}`
      )
    } else if (action.type === 'run-command') {
      const res = action.elevated
        ? await runAs(action.command)
        : await execCmd(action.command)
      logger.info(
        'install',
        `${cfg.name} 后置命令（elevated=${Boolean(action.elevated)}）退出码 ${res.code}`
      )
    } else if (action.type === 'create-shortcut') {
      const r = await shortcutService.createDesktopShortcut(cfg, sinceMs)
      if (r.ok) notes.push(r.message)
    }
  }
}

async function verifyConfig(cfg: InstallConfig): Promise<{ ok: boolean; output: string }> {
  if (!cfg.verify) return { ok: true, output: '' }
  const res = await execPS(cfg.verify.command, { timeoutMs: 120_000 })
  const output = (res.stdout || res.stderr).trim()
  const ok = cfg.verify.successPattern
    ? new RegExp(cfg.verify.successPattern, 'i').test(output)
    : res.code === 0
  logger.info('verify', `${cfg.name} 校验 ${ok ? '通过' : '未通过'}: ${output.split('\n')[0] ?? ''}`)
  return { ok, output }
}

export async function finishInstall(
  cfg: InstallConfig,
  filePath: string,
  update: UpdateFn
): Promise<InstallOutcome> {
  // 本轮安装开始时间：用于快捷方式去重时判定“安装器自建的 .lnk 是否本轮新建”
  const installStartMs = Date.now()
  const isZip = /\.zip$/i.test(filePath)
  const isExecutable = /\.(exe|msi)$/i.test(filePath)
  // 纯下载任务：目标非安装器，或（silentArgs 未定义且无解压目标），或 zip 资产无解压目标
  const downloadOnly =
    !isExecutable || (cfg.silentArgs === undefined && !cfg.extractZip) || (isZip && !cfg.extractZip)

  if (!downloadOnly && cfg.silentArgs !== undefined && isExecutable) {
    update({ status: 'installing', message: `静默安装 ${cfg.name}` })
    const code = await runSilentInstall(cfg, filePath)
    if (code !== 0) {
      const status = await degradeAfterFailure(cfg, `静默安装失败（退出码 ${code}）`, filePath)
      return { status, note: cfg.manualHint }
    }
  }

  // zip 解压（动漫共和国 / workbuddy辅助工具 / 影策 / FFmpeg）：绝对路径按原样；相对路径按类别分流——
  // devenv → 桌面（历史行为），daily/proxy → 安装根目录（D:\Apps，无 D 盘回退 C:\Apps）
  if (cfg.extractZip) {
    const target = path.isAbsolute(cfg.extractZip)
      ? cfg.extractZip
      : cfg.category === 'devenv'
        ? path.join(getDesktopPath(), cfg.extractZip)
        : path.join(getInstallRoot(), cfg.extractZip)
    update({ status: 'installing', message: `解压到 ${path.basename(target)}` })
    const escSource = filePath.replace(/'/g, "''")
    const escTarget = target.replace(/'/g, "''")
    const res = await execPS(
      `Expand-Archive -Path '${escSource}' -DestinationPath '${escTarget}' -Force`,
      { timeoutMs: 10 * 60_000 }
    )
    if (res.code !== 0) {
      logger.error('install', `${cfg.name} 解压失败: ${res.stderr.trim().slice(0, 300)}`)
      return { status: 'failed' }
    }
    logger.info('install', `${cfg.name} 解压完成: ${target}`)
  }

  const notes: string[] = []

  // v1.0.2 修复 A（P0）：zip 内层若是安装器（动漫共和国 zip 内即 NSIS setup），
  // 解压后必须自动静默执行，否则用户只拿到“装着安装器的文件夹”，软件根本没装上，
  // 桌面快捷方式还会误指向安装器本身。
  if (cfg.extractZip && cfg.runExtractedInstaller) {
    const extDir = path.isAbsolute(cfg.extractZip)
      ? cfg.extractZip
      : cfg.category === 'devenv'
        ? path.join(getDesktopPath(), cfg.extractZip)
        : path.join(getInstallRoot(), cfg.extractZip)
    const spec = cfg.runExtractedInstaller
    const setup = findExtractedInstaller(extDir, spec.pattern)
    if (setup) {
      const style = spec.installDirStyle ?? 'nsis'
      const cmd = buildInstallCommand(setup, spec.silentArgs, getInstallDirFor(cfg), style)
      update({ status: 'installing', message: `安装 ${path.basename(setup)}` })
      logger.info('install', `${cfg.name} 内层安装器命令: ${cmd}`)
      const t0 = Date.now()
      const res = await execCmd(cmd, { timeoutMs: 30 * 60_000 })
      logger.info(
        'install',
        `${cfg.name} 内层安装器退出码 ${res.code}（${((Date.now() - t0) / 1000).toFixed(1)}s）${res.stderr.trim() ? ` stderr: ${res.stderr.trim().slice(0, 300)}` : ''}`
      )
      if (res.code !== 0) {
        const status = await degradeAfterFailure(cfg, `内部安装器退出码 ${res.code}`, setup)
        return { status, note: cfg.manualHint }
      }
    } else {
      // 未找到匹配安装器：安装包已解压留档，用户仍可手动安装，不判 failed
      logger.warn(
        'install',
        `${cfg.name} 未在内层找到安装器（pattern=${spec.pattern}），已保留解压内容`
      )
      notes.push('未在内层找到安装器，已保留解压内容（可手动安装）')
    }
  }

  if (cfg.postActions?.length) {
    update({ status: 'installing', message: '执行安装后动作' })
    await runPostActions(cfg, update, notes, installStartMs)
  }

  // v1.0.2：桌面快捷方式（对所有 daily/proxy，含纯下载/解压项；受全局开关控制）
  const explicitShortcut = (cfg.postActions ?? []).some((a) => a.type === 'create-shortcut')
  if (!explicitShortcut && cfg.category !== 'devenv' && settings.get().createShortcut) {
    update({ status: 'installing', message: '创建桌面快捷方式' })
    const r = await shortcutService.createDesktopShortcut(cfg, installStartMs)
    if (r.ok) notes.push(r.message)
  }

  if (cfg.verify) {
    update({ status: 'verifying', message: `校验 ${cfg.name}` })
    const { ok, output } = await verifyConfig(cfg)
    if (!ok) {
      logger.error('verify', `${cfg.name} 校验失败: ${output.slice(0, 300)}`)
      return { status: 'failed' }
    }
  }

  // v1.0.2：架构自检（读取已安装主程序 PE 头，回答“是否 Win10 64 位版本”）
  const arch = await shortcutService.archNoteFor(cfg)
  if (arch) notes.push(arch)

  if (downloadOnly && cfg.source.kind !== 'none') {
    logger.info('install', `${cfg.name} 为下载任务，文件已就位: ${filePath}`)
  }
  void destDirFor
  return { status: 'success', note: notes.length > 0 ? notes.join('；') : undefined }
}
