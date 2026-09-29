/**
 * Edge 定制页（P0-9）：收藏夹导入 / 深色外观 / 下载目录，Edge 运行中警告与关闭。
 * 版式对齐原型 .tool-card / .tool-row（行内说明 + 右侧拨动开关）。
 */
import { useEffect, useState } from 'react'
import { IPC, type BookmarkPreview, type EdgeCustomizeResult } from '@shared/types'
import { call } from '../api'
import { useUiStore } from '../store/uiStore'
import { Icon } from '../components/Icons'
import Toggle from '../components/Toggle'

export default function BrowserPage(): JSX.Element {
  const toast = useUiStore((s) => s.toast)
  const requestConfirm = useUiStore((s) => s.requestConfirm)
  const [edgeRunning, setEdgeRunning] = useState<boolean | null>(null)
  const [preview, setPreview] = useState<BookmarkPreview | null>(null)
  const [favorites, setFavorites] = useState(true)
  const [dark, setDark] = useState(true)
  const [downloadDir, setDownloadDir] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<EdgeCustomizeResult | null>(null)

  const refreshStatus = (): void => {
    call<{ edgeRunning: boolean }>(IPC.EDGE_STATUS)
      .then((r) => setEdgeRunning(r.edgeRunning))
      .catch(() => setEdgeRunning(null))
  }

  useEffect(() => {
    refreshStatus()
    call<BookmarkPreview>(IPC.EDGE_PREVIEW)
      .then(setPreview)
      .catch(() => setPreview(null))
  }, [])

  const closeEdge = (): void => {
    requestConfirm({
      title: '关闭 Edge',
      message: '将强制结束所有 msedge.exe 进程，未保存的标签页将丢失。确定继续吗？',
      danger: true,
      confirmText: '强制关闭',
      onConfirm: async () => {
        try {
          const ok = await call<boolean>(IPC.EDGE_CLOSE)
          toast(ok ? 'Edge 已关闭' : '关闭后仍检测到 Edge 进程', ok ? 'success' : 'error')
          refreshStatus()
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error')
        }
      }
    })
  }

  const customize = async (): Promise<void> => {
    if (edgeRunning) {
      toast('请先关闭 Edge 再执行定制', 'error')
      return
    }
    if (!favorites && !dark && !downloadDir) {
      toast('请至少勾选一项定制内容', 'error')
      return
    }
    setRunning(true)
    setResult(null)
    try {
      const res = await call<EdgeCustomizeResult>(IPC.EDGE_CUSTOMIZE, {
        favorites,
        dark,
        downloadDir
      })
      setResult(res)
      toast(res.ok ? 'Edge 定制完成' : 'Edge 定制部分失败，详见结果', res.ok ? 'success' : 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setRunning(false)
    }
  }

  const rows: Array<{ label: string; desc: string; on: boolean; set: (v: boolean) => void }> = [
    {
      label: `导入收藏夹${preview ? `（${preview.links} 个链接 / ${preview.folders} 个文件夹）` : ''}`,
      desc: '解析桌面 Edge收藏夹.html（Netscape 格式）写入 Edge 收藏夹栏；栏外链接写入其他收藏夹',
      on: favorites,
      set: setFavorites
    },
    {
      label: '深色外观',
      desc: '写 Preferences: browser.theme.user_color_scheme = 2，重启 Edge 生效',
      on: dark,
      set: setDark
    },
    {
      label: '下载位置改为桌面',
      desc: '写 Preferences: download.default_directory = 桌面路径',
      on: downloadDir,
      set: setDownloadDir
    }
  ]

  return (
    <div className="kd-fade-in mx-auto max-w-[960px]">
      <div className="mb-[14px] flex items-baseline gap-[10px]">
        <h3 className="text-[14px] font-semibold text-white">浏览器定制</h3>
        <p className="text-xs text-dim">导入收藏夹 · 深色外观 · 下载位置（写前自动备份）</p>
        <span className="flex-1" />
        <span
          className={`kd-pill ${edgeRunning === null ? '' : edgeRunning ? 'c-warn' : 'c-ok'}`}
        >
          <i />
          {edgeRunning === null ? '检测中…' : edgeRunning ? 'Edge 运行中' : 'Edge 已关闭'}
        </span>
        <button type="button" className="kd-mini-btn" onClick={refreshStatus}>
          <Icon name="refresh" size={13} />
          刷新
        </button>
        {edgeRunning && (
          <button
            type="button"
            className="kd-mini-btn kd-mini-btn-danger"
            onClick={closeEdge}
          >
            <Icon name="x" size={13} />
            关闭 Edge
          </button>
        )}
      </div>

      {edgeRunning && (
        <div className="mb-4 flex items-center gap-2 rounded-[16px] border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          <Icon name="alert" size={15} />
          Edge 正在运行，无法写入收藏夹与偏好设置 —— 请先关闭 Edge。
        </div>
      )}

      <div className="kd-toolcard">
        {rows.map((r) => (
          <div key={r.label} className="kd-tool-row">
            <div className="flex-1">
              <b className="block text-[13px] font-semibold text-white">{r.label}</b>
              <small className="text-[11.5px] leading-[18px] text-dim">{r.desc}</small>
            </div>
            <Toggle on={r.on} onChange={r.set} title={r.label} />
          </div>
        ))}
      </div>

      {result && (
        <div className="kd-toolcard mt-4">
          {result.details.map((d, i) => (
            <div key={i} className={`py-0.5 text-xs ${result.ok ? 'text-ok' : 'text-manual'}`}>
              · {d}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5">
        <button
          type="button"
          className="kd-btn-primary"
          onClick={() => void customize()}
          disabled={running || Boolean(edgeRunning)}
        >
          <Icon name="zap" size={15} />
          {running ? '执行中…' : '一键 Edge 定制'}
        </button>
      </div>
    </div>
  )
}
