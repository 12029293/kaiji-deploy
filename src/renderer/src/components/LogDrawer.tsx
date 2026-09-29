/**
 * 底部日志抽屉（对齐原型 #drawer）：从底部滑出，等宽字体、分级着色、自动滚动。
 * 保留导出 txt 能力（LOG_EXPORT）。
 */
import { useEffect, useRef } from 'react'
import { useLogStore } from '../store/logStore'
import { useUiStore } from '../store/uiStore'
import { Icon } from './Icons'

const LEVEL_COLOR: Record<string, string> = {
  info: 'text-sub',
  warn: 'text-warn',
  error: 'text-bad'
}

export default function LogDrawer(): JSX.Element {
  const open = useUiStore((s) => s.logOpen)
  const setOpen = useUiStore((s) => s.setLogOpen)
  const entries = useLogStore((s) => s.entries)
  const clear = useLogStore((s) => s.clear)
  const exportLog = useLogStore((s) => s.exportLog)
  const toast = useUiStore((s) => s.toast)
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  const scrollRef = useRef<HTMLDivElement>(null)
  /** 与 Dock 同轴：居中于内容列 */
  const navW = collapsed ? 64 : 212

  useEffect(() => {
    const el = scrollRef.current
    if (el && open) el.scrollTop = el.scrollHeight
  }, [entries, open])

  const onExport = async (): Promise<void> => {
    try {
      const path = await exportLog()
      toast(path ? `日志已导出: ${path}` : '已取消导出', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  return (
    <section
      className={`kd-drawer ${open ? 'open' : ''}`}
      aria-hidden={!open}
      style={{
        left: `calc(50% + ${navW / 2}px)`,
        width: `min(1060px, calc(100vw - ${navW + 48}px))`
      }}
    >
      <div className="kd-drawer-head">
        <b className="text-[13px] font-semibold text-white">部署日志</b>
        <span className="kd-pill">{entries.length} 行</span>
        <span className="flex-1" />
        <button type="button" className="kd-mini-btn" onClick={clear}>
          清空
        </button>
        <button type="button" className="kd-mini-btn" onClick={() => void onExport()}>
          导出 txt
        </button>
        <button type="button" className="kd-mini-btn" onClick={() => setOpen(false)}>
          <Icon name="chevronDown" size={13} />
          收起
        </button>
      </div>

      <div ref={scrollRef} className="kd-logs">
        {entries.length === 0 && (
          <div className="pt-2 text-dim">
            等待部署事件…（下载 URL / 安装命令 / 退出码 / 校验结果均会输出在此）
          </div>
        )}
        {entries.map((e, i) => (
          <div key={`${e.ts}-${i}`} className="ln">
            <span className="ts">{e.ts}</span>
            <span className={`lv ${e.level}`}>{e.level.toUpperCase()}</span>
            <span className={LEVEL_COLOR[e.level] ?? 'text-sub'}>
              [{e.scope}] {e.text}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
