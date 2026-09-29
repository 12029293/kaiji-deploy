/**
 * 首次启动 Edge 定制引导弹窗（P1-2）：一键执行 收藏夹导入 + 深色主题 + 下载位置。
 * 执行或关闭后标记 onboardingDone（可在设置重置）。
 */
import { useState } from 'react'
import { IPC, type EdgeCustomizeResult } from '@shared/types'
import { call } from '../api'
import { useUiStore } from '../store/uiStore'
import { Icon } from './Icons'
import Toggle from './Toggle'

function OptionRow({
  label,
  desc,
  checked,
  onChange
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <div className="kd-tool-row">
      <div className="flex-1">
        <b className="block text-[13px] font-semibold text-white">{label}</b>
        <small className="text-[11.5px] text-dim">{desc}</small>
      </div>
      <Toggle on={checked} onChange={onChange} title={label} />
    </div>
  )
}

export default function OnboardingModal(): JSX.Element | null {
  const open = useUiStore((s) => s.onboardingOpen)
  const setOpen = useUiStore((s) => s.setOnboardingOpen)
  const toast = useUiStore((s) => s.toast)

  const [favorites, setFavorites] = useState(true)
  const [dark, setDark] = useState(true)
  const [downloadDir, setDownloadDir] = useState(true)
  const [running, setRunning] = useState(false)
  const [edgeRunning, setEdgeRunning] = useState(false)
  const [result, setResult] = useState<EdgeCustomizeResult | null>(null)

  if (!open) return null

  const markDone = async (): Promise<void> => {
    try {
      await call(IPC.ONBOARD_DONE, {})
    } catch {
      /* 标记失败不影响使用 */
    }
    setOpen(false)
  }

  const execute = async (): Promise<void> => {
    setRunning(true)
    setResult(null)
    try {
      // 前置检测：Edge 运行中先引导关闭（P0-9）
      const { edgeRunning: runningNow } = await call<{ edgeRunning: boolean }>(IPC.EDGE_STATUS)
      if (runningNow) {
        setEdgeRunning(true)
        setRunning(false)
        return
      }
      const res = await call<EdgeCustomizeResult>(IPC.EDGE_CUSTOMIZE, {
        favorites,
        dark,
        downloadDir
      })
      setResult(res)
      await call(IPC.ONBOARD_DONE, {})
      toast(res.ok ? 'Edge 定制完成' : 'Edge 定制部分失败，详见结果', res.ok ? 'success' : 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setRunning(false)
    }
  }

  const closeEdgeAndContinue = async (): Promise<void> => {
    setRunning(true)
    try {
      await call(IPC.EDGE_CLOSE)
      setEdgeRunning(false)
      const res = await call<EdgeCustomizeResult>(IPC.EDGE_CUSTOMIZE, {
        favorites,
        dark,
        downloadDir
      })
      setResult(res)
      await call(IPC.ONBOARD_DONE, {})
      toast(res.ok ? 'Edge 定制完成' : 'Edge 定制部分失败，详见结果', res.ok ? 'success' : 'error')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="kd-glass-strong kd-fade-in w-[560px] rounded-2xl p-6 shadow-dock">
        <div className="flex items-center gap-3">
          <div
            className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-white"
            style={{ background: 'var(--kd-grad)', boxShadow: '0 4px 14px rgba(34,211,238,.35)' }}
          >
            <Icon name="globe" size={19} />
          </div>
          <div>
            <h3 className="text-[15px] font-semibold text-white">欢迎使用开机部署助手</h3>
            <p className="text-xs text-dim">首次打开，建议先一键完成 Edge 浏览器定制</p>
          </div>
        </div>

        <div className="kd-toolcard mt-5 !bg-white/[0.02] !p-[10px]">
          <OptionRow
            label="导入收藏夹"
            desc="将桌面 Edge收藏夹.html 导入 Edge 收藏夹栏"
            checked={favorites}
            onChange={setFavorites}
          />
          <OptionRow
            label="深色外观"
            desc="Edge 外观改为深色主题（重启生效）"
            checked={dark}
            onChange={setDark}
          />
          <OptionRow
            label="下载位置改为桌面"
            desc="Edge 新下载默认保存到桌面"
            checked={downloadDir}
            onChange={setDownloadDir}
          />
        </div>

        {edgeRunning && (
          <div className="mt-4 flex items-center gap-2 rounded-[16px] border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
            <Icon name="alert" size={14} />
            <span className="flex-1">检测到 Edge 正在运行，需先关闭才能写入收藏夹与偏好设置</span>
            <button
              type="button"
              className="kd-mini-btn kd-mini-btn-danger shrink-0"
              onClick={() => void closeEdgeAndContinue()}
              disabled={running}
            >
              关闭 Edge 并继续
            </button>
          </div>
        )}

        {result && (
          <div className="kd-toolcard mt-4 !p-3">
            {result.details.map((d, i) => (
              <div key={i} className={`text-xs ${result.ok ? 'text-ok' : 'text-manual'}`}>
                · {d}
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => void markDone()}
            className="text-[13px] text-dim transition-colors hover:text-white"
            disabled={running}
          >
            稍后再说
          </button>
          <button
            type="button"
            className="kd-btn-primary"
            onClick={() => void execute()}
            disabled={running || (!favorites && !dark && !downloadDir)}
          >
            <Icon name="zap" size={15} />
            {running ? '执行中…' : '一键 Edge 定制'}
          </button>
        </div>
      </div>
    </div>
  )
}
