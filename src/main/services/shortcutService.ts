/**
 * 桌面快捷方式服务（v1.0.2 新增）：
 *  - pickMainExe：纯函数式主程序打分（便于单测）
 *  - 候选根按优先级定位：D:\Apps\<id> → extractZip 落地目录 → Program Files 系列按关键词匹配子目录
 *  - PowerShell WScript.Shell COM 创建 .lnk（失败回退 Public Desktop）
 *  - 幂等：同名 .lnk 且目标一致则跳过
 *  - 失败只 warn，绝不把安装任务判为 failed
 *  - archNoteFor：定位主程序后读取 PE 头，报告架构（架构自检）
 */
import fs from 'node:fs'
import path from 'node:path'
import type { InstallConfig } from '@shared/types'
import { logger } from '../core/logger'
import { execPS } from '../core/shellRunner'
import { getDesktopPath, getInstallRoot } from '../config/paths'
import { existsSafe } from '../utils/fsUtils'
import { describePe, readPeInfo } from '../utils/peInfo'

/** 被排除的目录名（避免扫描依赖/资源噪声） */
const SKIP_DIRS = new Set(['node_modules', 'resources', 'locales', 'locales_pak'])

/** 非主程序强扣分关键词（卸载器 / 安装器 / 辅助进程 / 运行时） */
const NEGATIVE_RE =
  /(unins|uninstall|setup|install|update|helper|crashpad|crash_reporter|crashpad_handler|elevate|vc_redist|_test|卸)/i

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
}

/**
 * 纯函数：从候选 exe 路径中挑选最像“主程序”的一个。
 * 规则：命中 id/名称 token 加分；层级越浅越优先；
 * **安装器/卸载器/辅助进程（见 NEGATIVE_RE）一律硬过滤，绝不作为主程序**（v1.0.2 修复 B）。
 * 过滤后无候选 → 返回 null（宁可没有快捷方式，也不指错）。
 */
export function pickMainExe(
  candidates: string[],
  cfg: { id: string; name: string }
): string | null {
  if (!candidates || candidates.length === 0) return null
  const id = (cfg.id ?? '').toLowerCase()
  const name = (cfg.name ?? '').toLowerCase()
  const idTokens = tokens(id)
  const nameTokens = tokens(name)
  let best: string | null = null
  let bestScore = -Infinity
  for (const p of candidates) {
    const fn = path.basename(p).toLowerCase()
    const stem = fn.replace(/\.exe$/i, '')
    // 硬过滤：安装器 / 卸载器 / 更新器 / 运行时等一律跳过
    if (NEGATIVE_RE.test(stem)) continue
    let score = 0
    // 层级：路径段越少越可能是根程序
    score -= p.split(/[\\/]+/).filter(Boolean).length
    if (stem === id || (name.length > 0 && stem === name)) score += 60
    if (id.length > 0 && fn.includes(id)) score += 25
    for (const t of idTokens) if (fn.includes(t)) score += 12
    for (const t of nameTokens) if (fn.includes(t)) score += 12
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return best
}

/** 递归收集 exe（深度上限 maxDepth，跳过 SKIP_DIRS；异常目录静默跳过） */
export function collectExeCandidates(roots: string[], maxDepth = 3, limit = 2000): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth || out.length >= limit) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (out.length >= limit) return
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name.toLowerCase())) continue
        walk(full, depth + 1)
      } else if (e.isFile() && /\.exe$/i.test(e.name)) {
        out.push(full)
      }
    }
  }
  for (const r of roots) {
    if (existsSafe(r)) walk(r, 1)
  }
  return out
}

/** 在给定根目录下递归查找 basename 匹配的文件（任意扩展名，浅层优先；跳过 SKIP_DIRS） */
export function findByBasename(roots: string[], basename: string, maxDepth = 4): string | null {
  const want = basename.toLowerCase()
  const walk = (dir: string, depth: number): string | null => {
    if (depth > maxDepth) return null
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return null
    }
    for (const e of entries) {
      if (e.isFile() && e.name.toLowerCase() === want) return path.join(dir, e.name)
    }
    for (const e of entries) {
      if (e.isDirectory() && !SKIP_DIRS.has(e.name.toLowerCase())) {
        const hit = walk(path.join(dir, e.name), depth + 1)
        if (hit) return hit
      }
    }
    return null
  }
  for (const r of roots) {
    if (existsSafe(r)) {
      const hit = walk(r, 0)
      if (hit) return hit
    }
  }
  return null
}

/** 非开发环境安装目录（与 installer.getInstallDirFor 语义一致；此处本地计算避免循环依赖） */
function installDirFor(cfg: InstallConfig): string | null {
  if (cfg.category === 'devenv') return null
  return path.join(getInstallRoot(), cfg.id)
}

/** extractZip 落地目录 */
export function extractDirFor(cfg: InstallConfig): string | null {
  if (!cfg.extractZip) return null
  if (path.isAbsolute(cfg.extractZip)) return cfg.extractZip
  return cfg.category === 'devenv'
    ? path.join(getDesktopPath(), cfg.extractZip)
    : path.join(getInstallRoot(), cfg.extractZip)
}

/** 用于在 Program Files 下挑选子目录的关键词 */
function keywordsFor(cfg: InstallConfig): string[] {
  const set = new Set<string>()
  const push = (s: string): void => {
    const t = (s ?? '').toLowerCase().trim()
    if (t.length >= 3) set.add(t)
  }
  push(cfg.id)
  for (const t of tokens(cfg.id)) push(t)
  for (const t of tokens(cfg.name)) push(t)
  return [...set]
}

function matchesAny(s: string, keywords: string[]): boolean {
  const l = s.toLowerCase()
  return keywords.some((k) => l.includes(k))
}

/** Program Files 系列下按关键词匹配到的目录（浅层 2 级，避免全盘扫描） */
function programFilesRoots(cfg: InstallConfig): string[] {
  const bases = [
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs') : undefined
  ].filter((r): r is string => Boolean(r))
  const keywords = keywordsFor(cfg)
  const out: string[] = []
  for (const base of bases) {
    let lvl1: fs.Dirent[] = []
    try {
      lvl1 = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory())
    } catch {
      continue
    }
    for (const d1 of lvl1) {
      const p1 = path.join(base, d1.name)
      if (matchesAny(d1.name, keywords)) {
        out.push(p1)
        continue
      }
      let lvl2: fs.Dirent[] = []
      try {
        lvl2 = fs.readdirSync(p1, { withFileTypes: true }).filter((e) => e.isDirectory())
      } catch {
        continue
      }
      for (const d2 of lvl2) {
        if (matchesAny(`${d1.name}/${d2.name}`, keywords)) out.push(path.join(p1, d2.name))
      }
    }
  }
  return out
}

/** 候选搜索根（按优先级） */
export function findSearchRoots(cfg: InstallConfig): string[] {
  const roots: string[] = []
  const install = installDirFor(cfg)
  if (install) roots.push(install)
  const ex = extractDirFor(cfg)
  if (ex) roots.push(ex)
  roots.push(...programFilesRoots(cfg))
  // 去重并仅保留存在目录
  return [...new Set(roots)].filter((r) => existsSafe(r))
}

/** 定位主程序（显式 shortcut.target 优先；未命中则递归兜底查找） */
export function detectMainExe(cfg: InstallConfig): { exe: string; root: string } | null {
  const explicit = cfg.shortcut?.target
  if (explicit) {
    const abs = path.isAbsolute(explicit)
      ? explicit
      : path.join(installDirFor(cfg) ?? '', explicit)
    if (existsSafe(abs)) return { exe: abs, root: path.dirname(abs) }
    // 显式 target 未命中（main.zip 解压常多一层顶层目录）→ 在解压/安装目录下按 basename 递归兜底
    const roots = [extractDirFor(cfg), installDirFor(cfg)].filter((r): r is string => Boolean(r))
    const hit = findByBasename(roots, path.basename(explicit))
    if (hit) {
      logger.info('shortcut', `${cfg.name} 显式快捷方式目标已兜底定位: ${hit}`)
      return { exe: hit, root: path.dirname(hit) }
    }
    logger.warn('shortcut', `${cfg.name} 显式快捷方式目标不存在且兜底未命中，跳过快捷方式: ${abs}`)
    return null
  }
  for (const root of findSearchRoots(cfg)) {
    const cands = collectExeCandidates([root], 3)
    if (cands.length === 0) continue
    const exe = pickMainExe(cands, cfg)
    if (exe) return { exe, root }
  }
  return null
}

function psQuote(s: string): string {
  return s.replace(/'/g, "''")
}

/** 写入 .lnk（PowerShell + WScript.Shell），返回退出码 */
async function writeLnk(
  lnk: string,
  target: string,
  workDir: string,
  args: string
): Promise<number> {
  const cmd =
    `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${psQuote(lnk)}');` +
    `$s.TargetPath='${psQuote(target)}';` +
    `$s.WorkingDirectory='${psQuote(workDir)}';` +
    `$s.Arguments='${psQuote(args)}';` +
    `$s.Save()`
  const res = await execPS(cmd, { timeoutMs: 60_000 })
  return res.code
}

export interface ShortcutResult {
  ok: boolean
  lnk?: string
  target?: string
  message: string
}

/** 脚本类目标后缀：双击 .ps1/.cmd 等默认无关联，必须显式经解释器启动 */
const SCRIPT_TARGET_RE = /\.(ps1|cmd|bat|vbs|js)$/i

/** Windows PowerShell 全路径（存在则用全路径，否则回退裸名交由 PATH 解析） */
function powershellPath(): string {
  const full = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  return existsSafe(full) ? full : 'powershell.exe'
}

/**
 * 规范化快捷方式目标路径：解析为绝对 + 去尾分隔符 + 小写，用于等价比较。
 * （WScript.Shell 读出的 TargetPath 大小写/斜杠可能与配置字符串不同。）
 */
function normalizeTarget(p: string): string {
  const t = (p ?? '').trim()
  if (!t) return ''
  try {
    return path.resolve(t).replace(/[\\/]+$/, '').toLowerCase()
  } catch {
    return t.toLowerCase()
  }
}

/** .lnk 文件名（去扩展名），用于与目标快捷方式名比对 */
function lnkBaseName(p: string): string {
  return path.basename(p).replace(/\.lnk$/i, '')
}

/** 文件修改时间（毫秒）；取不到返回 0 */
function mtimeMs(p: string): number {
  try {
    return fs.statSync(p).mtimeMs
  } catch {
    return 0
  }
}

/**
 * 枚举「用户桌面 + Public 桌面」下所有 .lnk 及其 TargetPath（WScript.Shell 读取）。
 * 供创建前去重：避免安装器自建 + 我们自建 → 同一主程序出现两条快捷方式（v1.0.2 修复）。
 */
export async function listDesktopLnkTargets(): Promise<Array<{ lnk: string; target: string }>> {
  const out: Array<{ lnk: string; target: string }> = []
  const cmd =
    '$sh=New-Object -ComObject WScript.Shell;' +
    "$dirs=@([Environment]::GetFolderPath('Desktop'),(Join-Path $env:PUBLIC 'Desktop'));" +
    'foreach($d in $dirs){ if(Test-Path -LiteralPath $d){ ' +
    'Get-ChildItem -LiteralPath $d -Filter *.lnk -ErrorAction SilentlyContinue | ForEach-Object { ' +
    "$t=''; try{$t=$sh.CreateShortcut($_.FullName).TargetPath}catch{}; " +
    'Write-Output ($_.FullName + [char]9 + $t) } } }'
  try {
    const res = await execPS(cmd, { timeoutMs: 60_000 })
    if (res.code !== 0) {
      logger.warn('shortcut', `枚举桌面快捷方式失败（退出码 ${res.code}），跳过去重检查`)
      return out
    }
    const text = res.stdout.replace(/^\uFEFF/, '')
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue
      const idx = raw.indexOf('\t')
      if (idx < 0) continue
      out.push({ lnk: raw.slice(0, idx), target: raw.slice(idx + 1) })
    }
  } catch (err) {
    logger.warn(
      'shortcut',
      `枚举桌面快捷方式异常，跳过去重检查: ${err instanceof Error ? err.message : String(err)}`
    )
  }
  return out
}

/**
 * 计算 .lnk 的 (TargetPath, Arguments, WorkingDirectory)。
 * 脚本类目标 → TargetPath 改为 powershell.exe，Arguments 加
 * `-ExecutionPolicy Bypass -File "<脚本绝对路径>" <附加参数>`，否则双击只会弹“选择打开方式”。
 */
export function resolveLaunchTarget(
  exe: string,
  cfg: InstallConfig
): { target: string; args: string; workDir: string } {
  const extra = (cfg.shortcut?.args ?? '').trim()
  if (SCRIPT_TARGET_RE.test(exe)) {
    const parts = ['-ExecutionPolicy Bypass -File', `"${exe}"`]
    if (extra) parts.push(extra)
    return { target: powershellPath(), args: parts.join(' '), workDir: path.dirname(exe) }
  }
  return {
    target: exe,
    args: extra,
    workDir: cfg.shortcut?.workDir ?? path.dirname(exe)
  }
}

/** 创建桌面快捷方式（含去重；失败只 warn） */
export async function createDesktopShortcut(
  cfg: InstallConfig,
  sinceMs?: number
): Promise<ShortcutResult> {
  const det = detectMainExe(cfg)
  if (!det) {
    logger.warn('shortcut', `${cfg.name} 未定位到主程序，跳过桌面快捷方式`)
    return { ok: false, message: '未定位到主程序，已跳过快捷方式' }
  }
  const name = cfg.shortcut?.name ?? cfg.name
  // 脚本类目标经 PowerShell 启动（见 resolveLaunchTarget）
  const launch = resolveLaunchTarget(det.exe, cfg)

  // v1.0.2 修复：快捷方式去重。安装器常自建一条指向同一主程序的 .lnk，
  // 若我们再建一条不同名快捷方式 → 同一 exe 出现两条。
  // v1.0.4（QA 3b 回归修复，二刀）：**写与清拆开**，顺序固定——
  //   1. 先清理：异名（basename ≠ 规范名）且 mtime ≥ installStartMs 的等价项
  //      （本轮内层安装器刚自建，来历可证）→ 删除；**同名且 fresh 的不删**（幂等覆盖即可）；
  //   2. 再判定：清理后仍存在任一等价项 mtime < installStartMs（旧项，含同名）
  //      → 跳过写入，不覆盖、不删除（保住旧 .lnk 上的自定义图标/参数）；
  //   3. 否则写入：writeLnk 写我方规范名。
  const detNorm = normalizeTarget(det.exe)
  if (detNorm) {
    const existing = await listDesktopLnkTargets()
    const equivalents = existing.filter((e) => normalizeTarget(e.target) === detNorm)
    if (equivalents.length > 0) {
      const foreign = equivalents.filter((e) => lnkBaseName(e.lnk) !== name)
      // 步骤 1：清理本轮自建的异名等价项（无 installStartMs 无法证明来历，不删）
      const freshForeign =
        typeof sinceMs === 'number'
          ? foreign.filter((e) => mtimeMs(e.lnk) >= sinceMs)
          : []
      for (const e of freshForeign) {
        logger.info(
          'shortcut',
          `${cfg.name} 清理本轮安装器自建的重复快捷方式: ${e.lnk}（目标同为 ${det.exe}）`
        )
        try {
          fs.rmSync(e.lnk, { force: true })
        } catch (err) {
          logger.warn(
            'shortcut',
            `${cfg.name} 删除重复快捷方式失败: ${e.lnk}（${err instanceof Error ? err.message : String(err)}）`
          )
        }
      }
      // 步骤 2：清理后仍存在早于本轮的等价项 → 保守跳过写入。
      // 未传 installStartMs 时无法证明任何异名项来历，保守跳过（同名视为幂等可覆盖）。
      const remaining = equivalents.filter((e) => !freshForeign.includes(e))
      const stale =
        typeof sinceMs === 'number'
          ? remaining.filter((e) => mtimeMs(e.lnk) < sinceMs)
          : remaining.filter((e) => lnkBaseName(e.lnk) !== name)
      if (stale.length > 0) {
        const keep = equivalents.find((e) => lnkBaseName(e.lnk) === name) ?? stale[0]
        logger.info(
          'shortcut',
          `${cfg.name} 桌面已存在等价快捷方式（${path.basename(keep.lnk)} → ${det.exe}），跳过创建`
        )
        return {
          ok: true,
          lnk: keep.lnk,
          target: det.exe,
          message: `已存在等价快捷方式，跳过创建（${path.basename(keep.lnk)}）`
        }
      }
    }
  }

  const primary = path.join(getDesktopPath(), `${name}.lnk`)
  let code = await writeLnk(primary, launch.target, launch.workDir, launch.args)
  let lnk = primary
  if (code !== 0) {
    const fallback = path.join(process.env.PUBLIC ?? 'C:\\Users\\Public', 'Desktop', `${name}.lnk`)
    logger.warn('shortcut', `${cfg.name} 桌面快捷方式写入失败（码 ${code}），回退 Public Desktop`)
    code = await writeLnk(fallback, launch.target, launch.workDir, launch.args)
    lnk = fallback
  }
  if (code !== 0) {
    logger.warn('shortcut', `${cfg.name} 创建桌面快捷方式失败（码 ${code}），不阻断任务`)
    return { ok: false, message: '快捷方式创建失败（已跳过）' }
  }
  logger.info(
    'shortcut',
    `${cfg.name} 已创建桌面快捷方式: ${lnk} -> ${launch.target}${launch.args ? ` ${launch.args}` : ''}`
  )
  return { ok: true, lnk, target: det.exe, message: `已创建桌面快捷方式（${path.basename(det.exe)}）` }
}

/** 架构自检：定位主程序后读取 PE 头，返回人类可读描述（定位不到返回 null） */
export async function archNoteFor(cfg: InstallConfig): Promise<string | null> {
  const det = detectMainExe(cfg)
  if (!det) return null
  const info = readPeInfo(det.exe)
  if (!info) {
    logger.warn('arch', `${cfg.name} 主程序 PE 头解析失败: ${det.exe}`)
    return null
  }
  const note = `已安装 ${path.basename(det.exe)}：${describePe(info)}`
  logger.info('arch', `${cfg.name} ${note}`)
  return note
}
