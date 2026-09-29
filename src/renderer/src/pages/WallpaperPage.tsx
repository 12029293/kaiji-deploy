/**
 * 壁纸页（v1.1.0）：Wallhaven 在线壁纸库（唯一来源，页面即壁纸墙）。
 * v1.1.0 变更：
 *  - 单一在线图库：移除旧双 Tab、多来源切换、登录凭据弹层与代理提示角标，
 *    页面头部仅标题 + 一句话说明
 *  - 移除代理硬门槛：请求统一走 downloader.currentDispatcher()
 *    （代理加速开=走代理，关=直连），直连失败 toast 展示真实网络错误
 *  - 分页修复：meta.last_page 全量解析，pager 移到图片网格下方
 *    （上一页 / 第 N 页 / 共 M 页 / 下一页），首/尾页按钮置灰，
 *    翻页回到网格顶部并显示加载态
 */
import { useEffect, useRef, useState } from 'react'
import {
  IPC,
  type WallhavenDownloadResult,
  type WallhavenPage,
  type WallhavenPhoto
} from '@shared/types'
import { call } from '../api'
import { useUiStore } from '../store/uiStore'

export default function WallpaperPage(): JSX.Element {
  const toast = useUiStore((s) => s.toast)

  /* ---------------- Wallhaven 列表状态 ---------------- */
  const [photos, setPhotos] = useState<WallhavenPhoto[]>([])
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [settingId, setSettingId] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const gridRef = useRef<HTMLDivElement | null>(null)

  /* ---------------- 列表加载（页码变化触发） ---------------- */
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await call<WallhavenPage>(IPC.WALLHAVEN_LIST, { page })
        if (cancelled || !mountedRef.current) return
        setPhotos(res.photos)
        setLastPage(Math.max(1, res.lastPage))
        setThumbs({})
        // 缩略图逐个懒下载缓存（主进程落盘后返回 dataUrl）
        for (const ph of res.photos) {
          if (cancelled || !mountedRef.current) return
          const dataUrl = await call<string>(IPC.WALLHAVEN_THUMB, { id: ph.id, url: ph.thumbUrl })
          if (cancelled || !mountedRef.current) return
          setThumbs((prev) => ({ ...prev, [ph.id]: dataUrl }))
        }
      } catch (err) {
        // v1.1.0：不再引导开代理，展示真实网络错误
        if (!cancelled && mountedRef.current) {
          toast(err instanceof Error ? err.message : String(err), 'error')
          setPhotos([])
        }
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [page, toast])

  /* ---------------- 翻页回到网格顶部 ---------------- */
  useEffect(() => {
    gridRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [page])

  /* ---------------- 下载原图并设壁纸 ---------------- */
  const downloadAndSet = async (ph: WallhavenPhoto): Promise<void> => {
    if (settingId) return
    setSettingId(ph.id)
    toast(`正在下载原图 ${ph.resW}x${ph.resH}…`, 'info')
    try {
      const r = await call<WallhavenDownloadResult>(IPC.WALLHAVEN_SET, {
        id: ph.id,
        url: ph.origUrl
      })
      toast(r.message, r.ok ? 'success' : 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setSettingId(null)
    }
  }

  const navBtn =
    'rounded-[9px] border border-white/[0.12] px-[12px] py-[6px] text-xs transition-colors hover:border-accent/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <div className="kd-fade-in mx-auto max-w-[1400px]">
      {/* 标题 + 说明（v1.1.0 简化：仅标题 + 一句话说明） */}
      <div className="mb-[14px] flex flex-wrap items-baseline gap-[10px]">
        <h3 className="text-[14px] font-semibold text-white">壁纸</h3>
        <p className="text-xs text-dim">
          Wallhaven 在线图库（动漫+一般 · 仅 SFW · ≥1080p），点击卡片下载原图并设为桌面
        </p>
      </div>

      {loading && <div className="mb-3 text-xs text-dim">正在拉取 Wallhaven 列表（第 {page} 页）…</div>}
      {!loading && photos.length === 0 && (
        <div className="mb-3 text-xs text-dim">此页暂无壁纸（可能已到末页，或网络不可达）</div>
      )}

      {/* 图片网格 */}
      <div
        ref={gridRef}
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}
      >
        {photos.map((ph) => {
          const thumb = thumbs[ph.id]
          const busy = settingId === ph.id
          return (
            <button
              key={ph.id}
              type="button"
              disabled={settingId !== null}
              onClick={() => void downloadAndSet(ph)}
              title={`下载原图并设为壁纸：wallhaven-${ph.id}（${ph.resW}x${ph.resH}）`}
              className="group relative h-[130px] overflow-hidden rounded-[16px] border border-white/[0.06] transition-all hover:-translate-y-0.5 hover:border-accent/60"
              style={{
                boxShadow: busy ? 'var(--kd-shadow-glow)' : undefined,
                borderColor: busy ? 'rgba(34,211,238,.6)' : undefined
              }}
            >
              {thumb ? (
                <img
                  src={thumb}
                  alt={`wallhaven-${ph.id}`}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] text-dim">
                  加载中…
                </div>
              )}
              <span className="pointer-events-none absolute right-[10px] top-[10px] rounded-lg bg-black/60 px-[9px] py-[3px] text-[10px] font-medium text-white">
                {ph.resW}x{ph.resH}
              </span>
              <span className="pointer-events-none absolute bottom-[10px] left-[10px] max-w-[55%] truncate rounded-lg bg-black/45 px-[9px] py-[3px] text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                wallhaven-{ph.id}
              </span>
              <span
                className="pointer-events-none absolute bottom-[10px] right-[10px] shrink-0 rounded-lg px-[9px] py-[3px] text-[11px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100"
                style={{ background: 'var(--kd-grad)' }}
              >
                {busy ? '下载中…' : '设为壁纸'}
              </span>
            </button>
          )
        })}
      </div>

      {/* 分页（v1.1.0：移到网格下方，首/尾页按钮置灰，共 M 页） */}
      <div className="mt-5 mb-2 flex items-center justify-center gap-3">
        <button
          type="button"
          className={navBtn}
          disabled={page <= 1 || loading}
          onClick={() => setPage(1)}
          title="回到第一页"
        >
          首页
        </button>
        <button
          type="button"
          className={navBtn}
          disabled={page <= 1 || loading}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          上一页
        </button>
        <span className="min-w-[7rem] text-center text-xs text-dim">
          第 <span className="font-semibold text-white">{page}</span> 页 / 共{' '}
          <span className="font-semibold text-white">{lastPage}</span> 页
        </span>
        <button
          type="button"
          className={navBtn}
          disabled={page >= lastPage || loading}
          onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
        >
          下一页
        </button>
      </div>
    </div>
  )
}
