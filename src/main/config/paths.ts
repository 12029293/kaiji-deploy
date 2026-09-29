/**
 * 路径约定（ARCH 共享知识 #5）：
 * 素材根目录唯一定义在此；支持开发期（桌面素材目录）与打包后（extraResources/assets）双模式。
 * 所有中文路径的 fs 操作统一走 fsUtils。
 */
import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'

/** 开发期素材根目录 */
const DEV_ASSET_ROOT = 'C:\\Users\\Administrator\\Desktop\\开机部署'

/**
 * 非开发环境软件的统一安装根目录：D:\Apps（用户要求一律装 D 盘）。
 * 目标机器不存在 D 盘时自动回退 C:\Apps，保证功能可用。
 */
export function getInstallRoot(): string {
  if (fs.existsSync('D:\\')) return 'D:\\Apps'
  return 'C:\\Apps'
}

/** 素材根目录（打包后 = resources/assets，开发期 = 桌面素材目录） */
export function getAssetRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'assets')
  }
  return DEV_ASSET_ROOT
}

/** 素材根目录下的相对路径拼接 */
export function getAssetPath(...segs: string[]): string {
  return path.join(getAssetRoot(), ...segs)
}

/** 桌面路径（处理 OneDrive 重定向等异常，兜底 USERPROFILE\Desktop） */
export function getDesktopPath(): string {
  try {
    return app.getPath('desktop')
  } catch {
    return path.join(process.env.USERPROFILE || 'C:\\Users\\Administrator', 'Desktop')
  }
}

/** 下载缓存目录（userData/downloads，P2-2 安装包缓存） */
export function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'downloads')
}

/** Edge User Data\\Default 目录 */
export function getEdgeDefaultDir(): string {
  const localAppData = process.env.LOCALAPPDATA || path.join(getHomeDir(), 'AppData', 'Local')
  return path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'Default')
}

function getHomeDir(): string {
  return process.env.USERPROFILE || 'C:\\Users\\Administrator'
}

/** Edge Bookmarks JSON 文件路径 */
export function getEdgeBookmarksPath(): string {
  return path.join(getEdgeDefaultDir(), 'Bookmarks')
}

/** Edge Preferences JSON 文件路径 */
export function getEdgePreferencesPath(): string {
  return path.join(getEdgeDefaultDir(), 'Preferences')
}

/** 收藏夹源 HTML（Netscape 格式，桌面根目录） */
export function getBookmarkSourceHtml(): string {
  return path.join(getDesktopPath(), 'Edge收藏夹.html')
}
