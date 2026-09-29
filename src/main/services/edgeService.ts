/**
 * Edge 定制服务（P0-9）：
 *  - 收藏夹：Netscape HTML → %LOCALAPPDATA%\Microsoft\Edge\User Data\Default\Bookmarks JSON
 *  - Preferences：深色主题（browser.theme.user_color_scheme=2）+ download.default_directory=桌面
 * 前置：isEdgeRunning() 检查（ARCH 共享知识 #8）；写 JSON 前备份 *.kd-bak。
 */
import { execCmd } from '../core/shellRunner'
import { logger } from '../core/logger'
import * as fsUtils from '../utils/fsUtils'
import {
  getBookmarkSourceHtml,
  getDesktopPath,
  getEdgeBookmarksPath,
  getEdgePreferencesPath
} from '../config/paths'
import { parseNetscape, toChromiumJson } from './edgeBookmarksParser'
import type { BookmarkPreview, EdgeCustomizeOptions, EdgeCustomizeResult } from '@shared/types'

class EdgeService {
  /** Edge 进程检测 */
  async isEdgeRunning(): Promise<boolean> {
    const res = await execCmd('tasklist /FI "IMAGENAME eq msedge.exe" | find /I "msedge.exe"', {
      timeoutMs: 30_000
    })
    return res.code === 0
  }

  /** 关闭 msedge（含确认后调用），返回关闭后是否已无进程 */
  async closeEdge(): Promise<boolean> {
    logger.warn('edge', '强制关闭 msedge.exe')
    await execCmd('taskkill /f /im msedge.exe', { timeoutMs: 30_000 })
    // 等待进程句柄释放
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1200)
    const stillRunning = await this.isEdgeRunning()
    if (stillRunning) logger.error('edge', 'msedge.exe 关闭后仍检测到进程')
    return !stillRunning
  }

  /** 解析收藏夹 HTML 预览统计 */
  async previewBookmarks(): Promise<BookmarkPreview> {
    const html = fsUtils.readTextSafe(getBookmarkSourceHtml())
    if (!html) throw new Error(`未找到收藏夹源文件: ${getBookmarkSourceHtml()}`)
    const parsed = parseNetscape(html)
    return { folders: parsed.folders, links: parsed.links }
  }

  /** 一键 Edge 定制：收藏夹导入 / 深色主题 / 下载目录（逐项容错） */
  async customize(opts: EdgeCustomizeOptions): Promise<EdgeCustomizeResult> {
    if (await this.isEdgeRunning()) {
      return { ok: false, details: ['Edge 正在运行，请先关闭 Edge 再执行定制'] }
    }
    const details: string[] = []
    let okAll = true

    if (opts.favorites) {
      try {
        const html = fsUtils.readTextSafe(getBookmarkSourceHtml())
        if (!html) throw new Error(`未找到收藏夹源文件: ${getBookmarkSourceHtml()}`)
        const parsed = parseNetscape(html)
        const json = toChromiumJson(parsed)
        fsUtils.writeJsonWithBackup(getEdgeBookmarksPath(), json)
        // Edge 的 Bookmarks.bak 会在启动时参与恢复，一并移除避免旧数据回滚
        fsUtils.removeSafe(`${getEdgeBookmarksPath()}.bak`)
        const msg = `收藏夹导入完成（${parsed.links} 个链接 / ${parsed.folders} 个文件夹）`
        details.push(msg)
        logger.info('edge', msg)
      } catch (err) {
        okAll = false
        const msg = `收藏夹导入失败: ${err instanceof Error ? err.message : String(err)}`
        details.push(msg)
        logger.error('edge', msg)
      }
    }

    if (opts.dark || opts.downloadDir) {
      try {
        const prefsPath = getEdgePreferencesPath()
        const prefs =
          fsUtils.readJsonSafe<Record<string, unknown>>(prefsPath) ??
          ({} as Record<string, unknown>)
        const browser = { ...((prefs['browser'] as Record<string, unknown>) ?? {}) }
        const download = { ...((prefs['download'] as Record<string, unknown>) ?? {}) }
        if (opts.dark) {
          const theme = { ...((browser['theme'] as Record<string, unknown>) ?? {}) }
          theme['user_color_scheme'] = 2 // Chromium: 2 = Dark（ARCH UNCLEAR 3，实测可微调）
          browser['theme'] = theme
          details.push('外观已设为深色（重启 Edge 生效）')
        }
        if (opts.downloadDir) {
          download['default_directory'] = getDesktopPath()
          details.push('下载目录已设为桌面')
        }
        prefs['browser'] = browser
        prefs['download'] = download
        fsUtils.writeJsonWithBackup(prefsPath, prefs)
        logger.info('edge', `Preferences 已更新（dark=${opts.dark} downloadDir=${opts.downloadDir}）`)
      } catch (err) {
        okAll = false
        const msg = `Preferences 写入失败: ${err instanceof Error ? err.message : String(err)}`
        details.push(msg)
        logger.error('edge', msg)
      }
    }

    return { ok: okAll, details }
  }
}

export const edgeService = new EdgeService()
