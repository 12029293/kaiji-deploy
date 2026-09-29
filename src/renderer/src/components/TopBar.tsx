/**
 * 顶部状态条：当前模块标题/副标题 + 三格计数（数字滚动）+ 三个配对开关 + 设置入口。
 * 开关与 Dock 内的同名开关共享 store，天然成对联动（对齐原型 pairSwitch）。
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { metaOf } from '../routes'
import { useOptionsStore } from '../store/optionsStore'
import { useProxyStore } from '../store/proxyStore'
import { useTasksStore } from '../store/tasksStore'
import { useUiStore } from '../store/uiStore'
import { Icon } from './Icons'
import Toggle from './Toggle'

/** 数字滚动动画（550ms 三次缓出），对齐原型 rollNumber */
function useCountUp(value: number): number {
  const [display, setDisplay] = useState(value)
  const targetRef = useRef(value)
  useEffect(() => {
    const from = targetRef.current
    if (from === value) return
    targetRef.current = value
    const t0 = performance.now()
    const dur = 550
    let raf = 0
    const step = (now: number): void => {
      const p = Math.min(1, (now - t0) / dur)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return display
}

function Stat({ dot, value, label }: { dot: string; value: number; label: string }): JSX.Element {
  const shown = useCountUp(value)
  return (
    <div
      className="flex min-w-[104px] shrink-0 items-center gap-[9px] rounded-xl border border-white/[0.06] px-[13px] py-[7px]"
      style={{ background: 'var(--kd-panel)' }}
    >
      <i className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} />
      <div className="flex items-baseline gap-1">
        <b className="kd-num text-base font-semibold leading-none text-white">{shown}</b>
        <small className="text-[11px] text-sub">{label}</small>
      </div>
    </div>
  )
}

export default function TopBar(): JSX.Element {
  const { pathname } = useLocation()
  const meta = metaOf(pathname)
  const summary = useTasksStore((s) => s.summary())
  const toast = useUiStore((s) => s.toast)
  const proxy = useProxyStore((s) => s.settings)
  const patchProxy = useProxyStore((s) => s.patch)
  const options = useOptionsStore((s) => s.options)
  const patchOptions = useOptionsStore((s) => s.patch)

  const waiting = Math.max(
    0,
    summary.total - summary.success - summary.failed - summary.manual - summary.active
  )

  const onProxy = async (next: boolean): Promise<void> => {
    try {
      const saved = await patchProxy({ enabled: next })
      toast(
        saved.enabled ? `代理加速已开启（${saved.host}:${saved.port}）` : '代理加速已关闭（直连）',
        saved.enabled ? 'success' : 'info'
      )
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const onOption = (patchValue: { createShortcut?: boolean; setAutostart?: boolean }): void => {
    patchOptions(patchValue).catch((err) =>
      toast(err instanceof Error ? err.message : String(err), 'error')
    )
  }

  return (
    <header
      className="flex shrink-0 items-center gap-3.5 border-b border-white/[0.06] px-[22px] py-3.5"
      style={{ background: 'rgba(13, 22, 31, 0.6)', backdropFilter: 'blur(30px) saturate(1.6)' }}
    >
      <div className="min-w-0">
        <h2 className="truncate text-[15px] font-semibold tracking-[.02em] text-white">
          {meta.label}
        </h2>
        <p className="-mt-0.5 truncate text-xs text-dim">{meta.sub}</p>
      </div>

      <div className="ml-3.5 flex shrink-0 gap-2.5">
        <Stat dot="var(--kd-ok)" value={summary.success} label="已装" />
        <Stat dot="var(--kd-cyan)" value={waiting} label="待装" />
        <Stat dot="var(--kd-err)" value={summary.failed} label="失败" />
      </div>

      <span className="flex-1" />

      <div className="flex shrink-0 items-center gap-3.5">
        <Toggle label="代理加速" on={proxy.enabled} onChange={(v) => void onProxy(v)} title="为 GitHub/外网下载开启本地代理" />
        <Toggle
          label="创建快捷方式"
          on={options.createShortcut}
          onChange={(v) => onOption({ createShortcut: v })}
          title="安装/解压完成后创建桌面快捷方式"
        />
        <Toggle
          label="开机启动"
          on={options.setAutostart}
          onChange={(v) => onOption({ setAutostart: v })}
          title="写入当前用户开机自启"
        />
        <button
          type="button"
          className="kd-icon-btn"
          title="设置"
          onClick={() =>
            toast('设置项已上移到顶栏与 Dock（代理加速 / 快捷方式 / 开机启动）', 'info')
          }
        >
          <Icon name="gear" size={17} />
        </button>
      </div>
    </header>
  )
}
