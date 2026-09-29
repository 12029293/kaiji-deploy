/**
 * 系统工具服务（P0-10 / P1-3）：
 * 删角标 4 功能 / 图标缓存重建 —— 本地 bat 交互式菜单逻辑翻译为原子 PowerShell/cmd 命令；
 * 磁贴美化 / 系统激活 / 禁用更新 —— 引用本地素材绝对路径一键启动。
 * 危险操作（taskkill explorer / 激活 / 禁用更新）由 renderer 侧 ConfirmDialog 二次确认。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execCmd, execPS } from '../core/shellRunner'
import { logger } from '../core/logger'
import { getAssetPath } from '../config/paths'
import type { ToolAction, ToolResult } from '@shared/types'

const SHELL_ICONS_KEY =
  'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Icons'
// 与素材 删角标.bat 一致：用 imageres.dll 197 号空白图标覆盖 29(角标)/77(盾牌) 覆盖层
const BLANK_ICON = '%SystemRoot%\\system32\\imageres.dll,197'

function combine(...results: { code: number; stdout: string; stderr: string }[]): ToolResult {
  const ok = results.every((r) => r.code === 0)
  const output = results
    .map((r) => [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n'))
    .filter(Boolean)
    .join('\n')
  return { ok, output }
}

/** 刷图标缓存（删角标.bat：taskkill explorer → 删 iconcache.db → start explorer） */
async function refreshIconCache(): Promise<ToolResult> {
  const r1 = await execCmd('taskkill /f /im explorer.exe', { timeoutMs: 30_000 })
  const r2 = await execCmd(
    'attrib -s -r -h "%UserProfile%\\AppData\\Local\\iconcache.db" & del "%UserProfile%\\AppData\\Local\\iconcache.db" /f /q',
    { timeoutMs: 30_000 }
  )
  const r3 = await execCmd('start explorer.exe', { timeoutMs: 30_000 })
  return combine(r1, r2, r3)
}

function regAdd29(): ReturnType<typeof execCmd> {
  return execCmd(`reg add "${SHELL_ICONS_KEY}" /v 29 /d "${BLANK_ICON}" /t reg_sz /f`, {
    timeoutMs: 30_000
  })
}

function regDelete(value: number | string): ReturnType<typeof execCmd> {
  return execCmd(`reg delete "${SHELL_ICONS_KEY}" /v ${value} /f`, { timeoutMs: 30_000 })
}

/** 图标缓存重建（新图标缓存.bat 全量逻辑，含托盘图标注册表清理） */
async function rebuildIconCache(): Promise<ToolResult> {
  const r1 = await execCmd('taskkill /f /im explorer.exe', { timeoutMs: 30_000 })
  const r2 = await execCmd(
    'attrib -h -s -r "%UserProfile%\\AppData\\Local\\IconCache.db" & del /f "%UserProfile%\\AppData\\Local\\IconCache.db"',
    { timeoutMs: 30_000 }
  )
  const r3 = await execCmd(
    'attrib /s /d -h -s -r "%UserProfile%\\AppData\\Local\\Microsoft\\Windows\\Explorer\\*"',
    { timeoutMs: 30_000 }
  )
  const r4 = await execCmd(
    'del /f "%UserProfile%\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_*.db"',
    { timeoutMs: 30_000 }
  )
  const r5 = await execCmd(
    'reg delete "HKEY_CLASSES_ROOT\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\TrayNotify" /v IconStreams /f & reg delete "HKEY_CLASSES_ROOT\\Local Settings\\Software\\Microsoft\\Windows\\CurrentVersion\\TrayNotify" /v PastIconsStream /f',
    { timeoutMs: 30_000 }
  )
  const r6 = await execCmd('start explorer.exe', { timeoutMs: 30_000 })
  return combine(r1, r2, r3, r4, r5, r6)
}

/** 启动本地 GUI 工具（可选提权），缺失时明确提示路径错误（P1-3） */
async function launchTool(
  exePath: string,
  opts: { elevated?: boolean; workdir?: boolean } = {}
): Promise<ToolResult> {
  if (!fs.existsSync(exePath)) {
    const msg = `程序不存在: ${exePath}`
    logger.error('tools', msg)
    return { ok: false, output: msg }
  }
  const esc = exePath.replace(/'/g, "''")
  const dir = opts.workdir ? path.dirname(exePath) : undefined
  const cmd = opts.elevated
    ? `Start-Process -FilePath '${esc}' -Verb RunAs`
    : dir
      ? `Start-Process -FilePath '${esc}' -WorkingDirectory '${dir.replace(/'/g, "''")}'`
      : `Start-Process -FilePath '${esc}'`
  const res = await execPS(cmd, { timeoutMs: 60_000 })
  logger.info('tools', `启动工具 ${path.basename(exePath)}（退出码 ${res.code}）`)
  return {
    ok: res.code === 0,
    output: [res.stdout.trim(), res.stderr.trim()].filter(Boolean).join('\n') || `已启动: ${exePath}`
  }
}

class SystemToolsService {
  /** 系统工具统一入口（IPC kd:tools:action） */
  async action(tool: ToolAction): Promise<ToolResult> {
    logger.info('tools', `执行系统工具: ${tool}`)
    switch (tool) {
      case 'badge-remove': {
        // 去角标：Shell Icons 29 → 空白图标 + 刷缓存
        const r = await regAdd29()
        const refresh = await refreshIconCache()
        return { ok: r.code === 0, output: [r.stdout + r.stderr, refresh.output].filter(Boolean).join('\n') }
      }
      case 'shield-remove': {
        // 去小盾牌：29 + 77 → 空白图标 + 刷缓存
        const r1 = await regAdd29()
        const r2 = await execCmd(
          `reg add "${SHELL_ICONS_KEY}" /v 77 /d "${BLANK_ICON}" /t reg_sz /f`,
          { timeoutMs: 30_000 }
        )
        const refresh = await refreshIconCache()
        return {
          ok: r1.code === 0 && r2.code === 0,
          output: [r1.stdout + r1.stderr, r2.stdout + r2.stderr, refresh.output]
            .filter(Boolean)
            .join('\n')
        }
      }
      case 'badge-restore': {
        // 恢复角标：删除 Shell Icons 29 + 刷缓存
        const r = await regDelete(29)
        const refresh = await refreshIconCache()
        return { ok: r.code === 0, output: [r.stdout + r.stderr, refresh.output].filter(Boolean).join('\n') }
      }
      case 'shield-restore': {
        // 恢复小盾牌：删除 29 + 77 + 刷缓存（可逆）
        const r1 = await regDelete(29)
        const r2 = await regDelete(77)
        const refresh = await refreshIconCache()
        return {
          ok: r1.code === 0 && r2.code === 0,
          output: [r1.stdout + r1.stderr, r2.stdout + r2.stderr, refresh.output]
            .filter(Boolean)
            .join('\n')
        }
      }
      case 'rebuild-icon-cache':
        return rebuildIconCache()
      case 'tiles':
        return launchTool(getAssetPath('磁贴美化小工具 v4.1.1', '磁贴美化小工具.exe'), {
          workdir: true
        })
      case 'activation':
        // 系统激活：管理员权限启动（P1-3）
        return launchTool(getAssetPath('系统激活.exe'), { elevated: true })
      case 'disable-update':
      case 'enable-update':
        // Windows Update Blocker（Wub_x64.exe GUI）：界面内选择禁用/恢复更新
        return launchTool(getAssetPath('禁用更新', 'Wub_x64.exe'), { workdir: true })
      default:
        return { ok: false, output: `未知工具: ${String(tool)}` }
    }
  }
}

export const systemToolsService = new SystemToolsService()
