/**
 * 底部悬浮 Dock（对齐原型 #dock）：
 * 环形总进度 + 当前任务文案 + 全选本页 + 日志/重试失败/开始安装。
 * 「全选本页」与开始安装的作用域跟随当前路由对应的软件分类。
 * v1.0.9：移除「快捷方式/开机启动」开关（与顶栏重复冲突，保留顶栏三开关）。
 */
import { useLocation } from 'react-router-dom'
import { metaOf } from '../routes'
import { useTasksStore } from '../store/tasksStore'
import { useUiStore } from '../store/uiStore'
import { Icon } from './Icons'

const CIRC = 2 * Math.PI * 20
const FINAL = ['success', 'failed', 'manual-needed']

export default function Dock(): JSX.Element {
  const { pathname } = useLocation()
  const meta = metaOf(pathname)

  const configs = useTasksStore((s) => s.configs)
  const tasks = useTasksStore((s) => s.tasks)
  const selected = useTasksStore((s) => s.selected)
  const setSelection = useTasksStore((s) => s.setSelection)
  const run = useTasksStore((s) => s.run)
  const retry = useTasksStore((s) => s.retry)
  const active = useTasksStore((s) => s.activeOne())
  const anyActive = useTasksStore((s) => s.anyActive())
  const retryable = useTasksStore((s) => s.retryableIds())

  const logOpen = useUiStore((s) => s.logOpen)
  const setLogOpen = useUiStore((s) => s.setLogOpen)
  const toast = useUiStore((s) => s.toast)
  const requestConfirm = useUiStore((s) => s.requestConfirm)
  const collapsed = useUiStore((s) => s.sidebarCollapsed)
  /** Dock 居中于「内容列」而非整个窗口，避免压住左侧导航（侧栏折叠时同步校正） */
  const navW = collapsed ? 64 : 212

  const selectedIds = configs.filter((c) => selected[c.id]).map((c) => c.id)
  const pageIds = meta.category
    ? configs.filter((c) => c.category === meta.category).map((c) => c.id)
    : []
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selected[id])
  const doneCount = selectedIds.filter((id) => FINAL.includes(tasks[id]?.status ?? 'pending')).length
  const okCount = selectedIds.filter((id) => tasks[id]?.status === 'success').length

  const ringOffset = selectedIds.length
    ? CIRC * (1 - doneCount / selectedIds.length)
    : CIRC

  const title = ((): string => {
    if (active) {
      const pct = `${Math.round(active.state.progress)}%`
      switch (active.state.status) {
        case 'downloading':
          return `正在下载: ${active.cfg.name} ${pct}`
        case 'installing':
          return `正在安装: ${active.cfg.name}`
        case 'checking':
          return `正在解析: ${active.cfg.name}`
        default:
          return `正在校验: ${active.cfg.name}`
      }
    }
    if (selectedIds.length === 0) return '就绪 · 选择要部署的软件'
    if (anyActive) return '部署进行中…'
    return `完成 ${doneCount} / ${selectedIds.length}${okCount ? ` · 成功 ${okCount}` : ''}`
  })()

  const start = (): void => {
    if (selectedIds.length === 0) {
      toast('请先勾选要部署的软件', 'warn')
      return
    }
    requestConfirm({
      title: '开始部署',
      message: `将按配置依次/并发下载并安装已勾选的 ${selectedIds.length} 项软件。静默失败的项会自动降级打开安装向导或官网，不阻塞其他任务。确定开始吗？`,
      confirmText: '开始安装',
      onConfirm: async () => {
        try {
          const started = await run(selectedIds)
          toast(`已启动 ${started} 个部署任务`, 'success')
        } catch (err) {
          toast(err instanceof Error ? err.message : String(err), 'error')
        }
      }
    })
  }

  const retryAll = async (): Promise<void> => {
    if (retryable.length === 0) {
      toast('当前没有失败/需手动的项', 'info')
      return
    }
    try {
      const started = await retry(retryable)
      toast(`已重试 ${started} 个任务`, 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  return (
    <footer
      className="kd-dock"
      style={{
        left: `calc(50% + ${navW / 2}px)`,
        width: `min(1060px, calc(100vw - ${navW + 48}px))`
      }}
    >
      <svg className="kd-ring" viewBox="0 0 48 48">
        <circle className="bg" cx="24" cy="24" r="20" />
        <circle
          className="fg"
          cx="24"
          cy="24"
          r="20"
          strokeDasharray={CIRC}
          strokeDashoffset={ringOffset}
        />
      </svg>

      <div className="min-w-[200px]">
        <b className="block max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-white">
          {title}
        </b>
        <small className="text-[11px] text-dim">
          已选 {selectedIds.length} / {configs.length}
        </small>
      </div>

      <div className="hidden items-center gap-3.5 xl:flex">
        {meta.category && (
          <label className="kd-switch-row" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={allPageSelected}
              onChange={(e) => setSelection(pageIds, e.target.checked)}
              style={{ accentColor: '#2E7FC4' }}
            />
            全选本页
          </label>
        )}
      </div>

      <div className="ml-auto flex items-center gap-[10px]">
        <button
          type="button"
          className="kd-btn-ghost"
          onClick={() => setLogOpen(!logOpen)}
          title="展开/收起部署日志"
        >
          日志
        </button>
        {retryable.length > 0 && (
          <button type="button" className="kd-btn-ghost" onClick={() => void retryAll()}>
            重试失败 <span className="cnt">{retryable.length}</span>
          </button>
        )}
        <button type="button" className="kd-btn-primary" disabled={anyActive} onClick={start}>
          <Icon name={anyActive ? 'zap' : 'play'} size={15} />
          {anyActive ? '部署中…' : `开始安装${selectedIds.length ? `（${selectedIds.length}）` : ''}`}
        </button>
      </div>
    </footer>
  )
}
