/**
 * 壁纸服务（P1-1）：扫描 壁纸/ 目录，静态图（jpg/png/jpeg 等）生成缩略图，
 * 点击通过 SystemParametersInfoW SPI_SETDESKWALLPAPER 设为桌面壁纸；mp4 列出但标记不支持。
 */
import fs from 'node:fs'
import path from 'node:path'
import { nativeImage } from 'electron'
import { execPS } from '../core/shellRunner'
import { logger } from '../core/logger'
import { getAssetPath } from '../config/paths'
import type { WallpaperItem } from '@shared/types'

const STATIC_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp'])

class WallpaperService {
  /** 扫描壁纸目录（isStatic=false 为 mp4 等动态壁纸，不可设置） */
  list(): WallpaperItem[] {
    const dir = getAssetPath('壁纸')
    try {
      return fs
        .readdirSync(dir)
        .map((name) => {
          try {
            const full = path.join(dir, name)
            if (!fs.statSync(full).isFile()) return null
            const ext = path.extname(name).toLowerCase()
            return { name, path: full, isStatic: STATIC_EXTS.has(ext) }
          } catch {
            return null
          }
        })
        .filter((x): x is WallpaperItem => x !== null)
        .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    } catch (err) {
      logger.error('wallpaper', `壁纸目录扫描失败: ${String(err)}（${dir}）`)
      return []
    }
  }

  /** nativeImage 缩略图（返回 dataUrl，读取失败返回空串） */
  thumb(p: string): string {
    try {
      const img = nativeImage.createFromPath(p)
      if (img.isEmpty()) return ''
      return img.resize({ width: 320 }).toDataURL()
    } catch {
      return ''
    }
  }

  /** SystemParametersInfoW SPI_SETDESKWALLPAPER(20) 设壁纸（SPIF_UPDATEINIFILE|SPIF_SENDCHANGE=3） */
  async setWallpaper(p: string): Promise<boolean> {
    if (!fs.existsSync(p)) {
      logger.error('wallpaper', `壁纸文件不存在: ${p}`)
      return false
    }
    const esc = p.replace(/'/g, "''")
    const script = [
      "Add-Type -MemberDefinition '[DllImport(\"user32.dll\", CharSet = CharSet.Auto)] public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);' -Name SpW -Namespace W32",
      `[W32.SpW]::SystemParametersInfo(20, 0, '${esc}', 3)`
    ].join('; ')
    const res = await execPS(script, { timeoutMs: 30_000 })
    const ok = res.code === 0 && res.stdout.trim() !== '0'
    logger.info('wallpaper', `${ok ? '已设为桌面壁纸' : '设置失败'}: ${path.basename(p)}`)
    return ok
  }
}

export const wallpaperService = new WallpaperService()
