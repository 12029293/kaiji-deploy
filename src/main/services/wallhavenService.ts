/**
 * Wallhaven 在线壁纸服务（v1.1.0，唯一在线壁纸来源）：
 * - 搜索 API：https://wallhaven.cc/api/v1/search?atleast=1920x1080&sorting=hot&categories=100&purity=100&page={n}
 *   categories=100 = 动漫+一般（排除人物），purity=100 = 仅 SFW（侦察实测 24/24 sfw）
 * - 分页：meta.current_page / meta.last_page（v1.1.0 修复：此前只回传图片数组导致 UI
 *   无法得知总页数）；越界页返回 200 + data:[]（判空翻页）
 * - 原图直链（w.wallhaven.cc）裸请求即可下载（无需 Referer/UA/Cookie），支持 Range
 * - 网络（v1.1.0 变更）：统一走 downloader.currentDispatcher()（「代理加速」开=走代理，
 *   关=直连），不再对未开代理做硬阻断——直连失败时向用户展示真实网络错误即可
 * - 频控 ≤45 req/min：API 请求走 1.5s 串行节流闸门；列表用 thumbs.large，
 *   点击卡片才下原图；客户端再做 ≥1920x1080 resolution 过滤 + 落盘前像素校验
 * - 缩略图缓存 userData/cache/wallhaven/thumb/{id}.jpg；
 *   原图落 userData/wallpapers/wallhaven/{id}_{W}x{H}.jpg → 复用 wallpaperService.setWallpaper
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, nativeImage } from 'electron'
import { logger } from '../core/logger'
import { currentDispatcher } from '../core/downloader'
import { wallpaperService } from './wallpaperService'
import { parsePixels } from '../utils/imageMeta'
import { RateGate, Semaphore } from '../utils/concurrency'
import type { WallhavenDownloadResult, WallhavenPage, WallhavenPhoto } from '@shared/types'

const API_BASE = 'https://wallhaven.cc/api/v1/search'
/** 最小像素门槛：只抓 ≥1920x1080 原图 */
const MIN_W = 1920
const MIN_H = 1080
/** 频控间隔：≤45 req/min */
const API_INTERVAL_MS = 1500

/** 搜索 URL（公开导出供测试断言） */
export function searchUrl(page: number): string {
  const p = Math.max(1, Math.floor(page) || 1)
  return `${API_BASE}?atleast=1920x1080&sorting=hot&categories=100&purity=100&page=${p}`
}

/** 搜索 API 响应条目（仅取本服务关心的字段） */
interface WallhavenApiItem {
  id?: string
  path?: string
  resolution?: string
  thumbs?: { large?: string }
}

/** 搜索 API 响应 meta（分页字段） */
interface WallhavenApiMeta {
  current_page?: number
  last_page?: number
}

/**
 * 解析搜索 API JSON → WallhavenPhoto[]。
 * 规则：id/path 缺失跳过；resolution 解析失败跳过；客户端再过滤 ≥1920x1080；
 * 越界页（data:[]）自然返回空数组。
 */
export function parseSearchResponse(json: unknown): WallhavenPhoto[] {
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  const out: WallhavenPhoto[] = []
  for (const raw of data) {
    const it = raw as WallhavenApiItem
    if (typeof it.id !== 'string' || it.id.length === 0) continue
    if (typeof it.path !== 'string' || it.path.length === 0) continue
    const m = /^(\d{2,5})x(\d{2,5})$/.exec(String(it.resolution ?? ''))
    if (!m) continue
    const resW = Number(m[1])
    const resH = Number(m[2])
    if (resW < MIN_W || resH < MIN_H) continue
    out.push({
      id: it.id,
      resW,
      resH,
      thumbUrl: typeof it.thumbs?.large === 'string' ? it.thumbs.large : '',
      origUrl: it.path
    })
  }
  return out
}

/**
 * 解析分页 meta（v1.1.0 修复三）：meta.current_page / meta.last_page。
 * 规则：非法/缺失时回退——current_page 回退为请求页码；last_page 回退为 current_page
 * （last_page 缺失时 UI 靠「下一页返回空数组自动停在末页」的越界判空兜底）。
 */
export function parseMeta(json: unknown, requestPage: number): { page: number; lastPage: number } {
  const meta = (json as { meta?: WallhavenApiMeta | null } | null)?.meta
  const req = Math.max(1, Math.floor(requestPage) || 1)
  const cur = Number(meta?.current_page)
  const last = Number(meta?.last_page)
  const page = Number.isFinite(cur) && cur >= 1 ? Math.floor(cur) : req
  let lastPage = page
  if (Number.isFinite(last) && last >= 1) {
    lastPage = Math.floor(last)
  } else if (page > req) {
    // 服务端页码前跳（罕见）：至少允许继续向后翻
    lastPage = page
  }
  // meta.last_page 缺失且本页有数据：允许继续翻页（last_page=page+1 触发下一页可点）
  if (!Number.isFinite(last) || last < 1) {
    const count = Array.isArray((json as { data?: unknown[] } | null)?.data)
      ? ((json as { data: unknown[] }).data.length)
      : 0
    if (count > 0) lastPage = page + 1
  }
  // 注意：不做 Math.max(lastPage, page) 钳制——越界页（page > last_page）必须保留
  // 服务端 last_page，UI 据此置灰「下一页」（v1.1.0 修复三）
  return { page, lastPage }
}

export class WallhavenService {
  private readonly apiGate: RateGate
  private readonly dlGate: Semaphore

  constructor(apiIntervalMs = API_INTERVAL_MS, maxDownloadConcurrency = 2) {
    this.apiGate = new RateGate(apiIntervalMs)
    this.dlGate = new Semaphore(maxDownloadConcurrency)
  }

  /* ---------------- 路径 ---------------- */

  private thumbCachePath(id: string): string {
    return path.join(app.getPath('userData'), 'cache', 'wallhaven', 'thumb', `${id}.jpg`)
  }

  private origDir(): string {
    return path.join(app.getPath('userData'), 'wallpapers', 'wallhaven')
  }

  /* ---------------- 网络（代理加速开=走代理，关=直连） ---------------- */

  /** 应用代理 dispatcher（downloader 同一套「代理加速」机制）；未开启返回 null（直连） */
  private dispatcher(): unknown {
    return currentDispatcher() ?? null
  }

  /**
   * GET：返回原始字节。请求失败抛错（调用方决定降级/提示）。
   * v1.1.0：未开启代理不再抛 WALLHAVEN_PROXY_DISABLED，直接直连。
   * 原图下载无需任何 Referer/UA/Cookie（侦察实测裸请求 206/200）。
   */
  private async fetchBuf(url: string, timeoutMs = 60_000): Promise<Buffer> {
    const dispatcher = this.dispatcher()
    const res = await fetch(url, {
      // Node 全局 fetch（undici）支持 dispatcher 透传（null = 直连）
      ...(dispatcher ? { dispatcher } : {}),
      signal: AbortSignal.timeout(timeoutMs)
    } as RequestInit)
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${url}`)
    }
    return Buffer.from(await res.arrayBuffer())
  }

  /* ---------------- 列表 / 缩略图 ---------------- */

  /**
   * 拉取热榜某页列表（≥1080p 过滤后）。
   * v1.1.0：返回 WallhavenPage（photos + page + lastPage），供 UI 渲染「共 M 页」；
   * 越界页（data:[]）返回空 photos。API 请求走 1.5s 串行节流闸门。
   */
  async listPhotos(page: number): Promise<WallhavenPage> {
    const url = searchUrl(page)
    const text = await this.apiGate.run(async () => {
      const buf = await this.fetchBuf(url)
      return buf.toString('utf8')
    })
    const json = JSON.parse(text) as unknown
    const photos = parseSearchResponse(json)
    const meta = parseMeta(json, page)
    return { photos, page: meta.page, lastPage: meta.lastPage }
  }

  /**
   * 缩略图：缓存命中直接读盘，未命中下载 thumbs.large（走当前 dispatcher + 节流闸门），
   * 缓存到 userData/cache/wallhaven/thumb/{id}.jpg，返回 dataUrl（失败返回空串）。
   */
  async thumb(id: string, url?: string): Promise<string> {
    const cache = this.thumbCachePath(id)
    try {
      if (!fs.existsSync(cache)) {
        if (!url) return ''
        const buf = await this.apiGate.run(() => this.fetchBuf(url))
        fs.mkdirSync(path.dirname(cache), { recursive: true })
        fs.writeFileSync(cache, buf)
      }
      const img = nativeImage.createFromPath(cache)
      if (img.isEmpty()) return ''
      return img.resize({ width: 320 }).toDataURL()
    } catch (err) {
      logger.warn('wallhaven', `缩略图处理失败 id=${id}: ${String(err)}`)
      return ''
    }
  }

  /* ---------------- 原图下载 + 设壁纸 ---------------- */

  /**
   * 下载原图并设为桌面壁纸（v1.1.0：移除 no-proxy 硬阻断，请求统一走当前 dispatcher）：
   * 1) 裸请求下载 origUrl（w.wallhaven.cc，无需任何头）；
   * 2) JPEG SOF/PNG IHDR 像素校验 ≥1920x1080（复用公共 parsePixels）；
   * 3) 落盘 {origDir}/{id}_{W}x{H}.jpg → 复用 wallpaperService.setWallpaper。
   * 网络失败返回 reason=network，message 携带真实错误（可能是代理未开导致的直连被墙）。
   */
  async downloadAndSet(id: string, origUrl: string): Promise<WallhavenDownloadResult> {
    if (!origUrl) {
      return { ok: false, reason: 'network', message: '缺少原图直链' }
    }
    try {
      return await this.dlGate.run(async () => {
        const buf = await this.fetchBuf(origUrl, 120_000)
        const dim = parsePixels(buf)
        if (!dim) {
          return { ok: false, reason: 'parse-failed', message: '无法解析原图尺寸，已放弃' }
        }
        if (dim.w < MIN_W || dim.h < MIN_H) {
          return {
            ok: false,
            reason: 'too-small',
            message: `原图 ${dim.w}x${dim.h} 低于 ${MIN_W}x${MIN_H}，已放弃`
          }
        }
        const dir = this.origDir()
        fs.mkdirSync(dir, { recursive: true })
        const file = path.join(dir, `${id}_${dim.w}x${dim.h}.jpg`)
        fs.writeFileSync(file, buf)
        logger.info('wallhaven', `原图已下载: ${file}（${buf.length} 字节）`)

        const ok = await wallpaperService.setWallpaper(file)
        if (!ok) {
          return { ok: false, reason: 'set-failed', message: '原图已下载但设置壁纸失败，详见日志', path: file }
        }
        return { ok: true, message: `已设为桌面壁纸（${dim.w}x${dim.h}）`, path: file }
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      logger.error('wallhaven', `下载原图 ${id} 失败: ${msg}`)
      return { ok: false, reason: 'network', message: `网络请求失败：${msg}` }
    }
  }
}

export const wallhavenService = new WallhavenService()
