/**
 * 日常软件（20 项）：卡片网格 + 部署方案保存/加载（P2-1）。
 * 批量勾选/开始安装统一收口到底部 Dock；页内只保留「方案」入口。
 */
import { useTasksStore } from '../store/tasksStore'
import { useUiStore } from '../store/uiStore'
import { IPC } from '@shared/types'
import { call } from '../api'
import AppCard from '../components/AppCard'
import { Icon } from '../components/Icons'

export default function DailyAppsPage(): JSX.Element {
  const byCategory = useTasksStore((s) => s.byCategory)
  const selectedIds = useTasksStore((s) => s.selectedIds)
  const setSelection = useTasksStore((s) => s.setSelection)
  const toast = useUiStore((s) => s.toast)
  const list = byCategory('daily')

  const savePlan = async (): Promise<void> => {
    try {
      const selections: Record<string, boolean> = {}
      for (const cfg of list) selections[cfg.id] = selectedIds('daily').includes(cfg.id)
      await call(IPC.PLAN_SAVE, { selections })
      toast('部署方案已保存（勾选状态持久化）', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const loadPlan = async (): Promise<void> => {
    try {
      const plan = await call<Record<string, boolean>>(IPC.PLAN_LOAD)
      if (Object.keys(plan).length === 0) {
        toast('暂无已保存的部署方案', 'info')
        return
      }
      setSelection(
        list.map((c) => c.id),
        false
      )
      setSelection(
        list.filter((c) => plan[c.id]).map((c) => c.id),
        true
      )
      toast('部署方案已加载，勾选状态已还原', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  return (
    <div className="kd-fade-in mx-auto max-w-[1400px]">
      <div className="mb-[14px] flex items-baseline gap-[10px]">
        <h3 className="text-[14px] font-semibold text-white">日常软件</h3>
        <p className="text-xs text-dim">
          {list.length} 项 · 解析官网/GitHub 最新版，静默安装到指定磁盘
        </p>
        <span className="flex-1" />
        <button type="button" className="kd-mini-btn" onClick={() => void savePlan()}>
          保存方案
        </button>
        <button type="button" className="kd-mini-btn" onClick={() => void loadPlan()}>
          <Icon name="download" size={13} />
          加载方案
        </button>
      </div>

      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}
      >
        {list.map((cfg, i) => (
          <AppCard key={cfg.id} cfg={cfg} index={i} />
        ))}
      </div>
    </div>
  )
}
