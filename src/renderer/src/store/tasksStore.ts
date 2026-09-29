/**
 * 全局任务状态（zustand）：按模块分组、完成度汇总计算、勾选状态、批量动作。
 * renderer 一律消费 TaskState DTO，不重复实现状态逻辑（ARCH 共享知识 #2）。
 */
import { create } from 'zustand'
import { IPC, type AppConfigView, type Category, type TaskState, type TaskStatus } from '@shared/types'
import { call } from '../api'

const ACTIVE_STATUSES: TaskStatus[] = ['checking', 'downloading', 'installing', 'verifying']

interface TasksStoreState {
  configs: AppConfigView[]
  tasks: Record<string, TaskState>
  loaded: boolean
  /** 勾选状态（configId → checked），默认全选 */
  selected: Record<string, boolean>
  init: () => Promise<void>
  setTask: (state: TaskState) => void
  byCategory: (category: Category) => AppConfigView[]
  statusOf: (id: string) => TaskState
  toggle: (id: string) => void
  setSelection: (ids: string[], value: boolean) => void
  selectedIds: (category?: Category) => string[]
  run: (ids: string[]) => Promise<number>
  retry: (ids: string[]) => Promise<number>
  summary: () => { total: number; success: number; failed: number; manual: number; active: number; percent: number }
  categorySummary: (category: Category) => { total: number; success: number; percent: number }
  /** 某分类（或全局）是否有任务进行中 —— Dock/顶栏按钮禁用依据 */
  anyActive: (category?: Category) => boolean
  /** 某分类（或全局）中可重试（失败 / 需手动）的 id */
  retryableIds: (category?: Category) => string[]
  /** 当前正在跑的“主角”任务（Dock 文案用） */
  activeOne: () => { cfg: AppConfigView; state: TaskState } | null
}

export const useTasksStore = create<TasksStoreState>()((set, get) => ({
  configs: [],
  tasks: {},
  loaded: false,
  selected: {},

  init: async () => {
    try {
      const [configs, taskList] = await Promise.all([
        call<AppConfigView[]>(IPC.APPS_GET_CONFIGS),
        call<TaskState[]>(IPC.TASKS_GET_ALL)
      ])
      const tasks: Record<string, TaskState> = {}
      for (const t of taskList) tasks[t.configId] = t
      // 默认全选
      const selected: Record<string, boolean> = {}
      for (const c of configs) selected[c.id] = true
      set({ configs, tasks, selected, loaded: true })
    } catch (err) {
      // 订阅仍要建立，避免错过事件
      set({ loaded: false })
      throw err
    } finally {
      window.kdAPI.onTask((state) => get().setTask(state))
    }
  },

  setTask: (state) => {
    set((s) => ({ tasks: { ...s.tasks, [state.configId]: state } }))
  },

  byCategory: (category) => get().configs.filter((c) => c.category === category),

  statusOf: (id) =>
    get().tasks[id] ?? { configId: id, status: 'pending', progress: 0, message: '等待部署' },

  toggle: (id) => {
    set((s) => ({ selected: { ...s.selected, [id]: !s.selected[id] } }))
  },

  setSelection: (ids, value) => {
    set((s) => {
      const selected = { ...s.selected }
      for (const id of ids) selected[id] = value
      return { selected }
    })
  },

  selectedIds: (category) => {
    const s = get()
    return s.configs
      .filter((c) => (!category || c.category === category) && s.selected[c.id])
      .map((c) => c.id)
  },

  run: async (ids) => {
    if (ids.length === 0) return 0
    const res = await call<{ started: number }>(IPC.TASKS_RUN, { configIds: ids })
    return res.started
  },

  retry: async (ids) => {
    if (ids.length === 0) return 0
    const res = await call<{ started: number }>(IPC.TASKS_RETRY, { configIds: ids })
    return res.started
  },

  summary: () => {
    const s = get()
    const all = Object.values(s.tasks)
    const total = s.configs.length
    const success = all.filter((t) => t.status === 'success').length
    const failed = all.filter((t) => t.status === 'failed').length
    const manual = all.filter((t) => t.status === 'manual-needed').length
    const active = all.filter((t) => ACTIVE_STATUSES.includes(t.status)).length
    return { total, success, failed, manual, active, percent: total ? Math.round((success / total) * 100) : 0 }
  },

  categorySummary: (category) => {
    const s = get()
    const list = s.byCategory(category)
    const success = list.filter((c) => s.tasks[c.id]?.status === 'success').length
    return {
      total: list.length,
      success,
      percent: list.length ? Math.round((success / list.length) * 100) : 0
    }
  },

  anyActive: (category) => {
    const s = get()
    return s.configs
      .filter((c) => !category || c.category === category)
      .some((c) => ACTIVE_STATUSES.includes(s.tasks[c.id]?.status ?? 'pending'))
  },

  retryableIds: (category) => {
    const s = get()
    return s.configs
      .filter((c) => !category || c.category === category)
      .filter((c) => {
        const st = s.tasks[c.id]?.status
        return st === 'failed' || st === 'manual-needed'
      })
      .map((c) => c.id)
  },

  activeOne: () => {
    const s = get()
    const found = s.configs.find((c) => ACTIVE_STATUSES.includes(s.tasks[c.id]?.status ?? 'pending'))
    if (!found) return null
    const state = s.tasks[found.id]
    return state ? { cfg: found, state } : null
  }
}))
