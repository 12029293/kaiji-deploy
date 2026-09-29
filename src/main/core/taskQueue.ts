/**
 * 并发调度器：下载并发 3 / 安装互斥（防注册表冲突），任务状态机驱动（ARCH §3.2）。
 * 状态推送：Map 维护 TaskState → webContents.send('kd:event:task')。
 */
import { BrowserWindow } from 'electron'
import { IPC, type InstallConfig, type TaskState, type TaskStatus } from '@shared/types'
import { logger } from './logger'
import * as installer from '../engine/installer'

/** 计数信号量（下载并发控制） */
class Semaphore {
  private active = 0
  private waiters: Array<() => void> = []

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
    this.active++
  }

  release(): void {
    this.active--
    const next = this.waiters.shift()
    if (next) next()
  }
}

class TaskQueue {
  private states = new Map<string, TaskState>()
  private cancelled = new Set<string>()
  private running = new Set<string>()
  private readonly downloadSem = new Semaphore(3)
  private readonly installMutex = new Semaphore(1)
  private configs: InstallConfig[] = []

  /** 注册全部配置并初始化任务快照（应用启动时调用一次） */
  registerConfigs(list: InstallConfig[]): void {
    this.configs = [...list]
    for (const cfg of list) {
      if (!this.states.has(cfg.id)) {
        this.states.set(cfg.id, {
          configId: cfg.id,
          status: 'pending',
          progress: 0,
          message: '等待部署'
        })
      }
    }
  }

  getConfigs(): InstallConfig[] {
    return this.configs
  }

  getState(configId: string): TaskState | undefined {
    return this.states.get(configId)
  }

  getAll(): TaskState[] {
    return [...this.states.values()]
  }

  /** 推送任务状态到所有窗口 */
  emitState(state: TaskState): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.EVENT_TASK, state)
      }
    }
  }

  /**
   * 入队批量任务，返回实际启动数量。
   * 已在执行中的任务跳过；pending 任务重置后重新执行。
   */
  enqueue(ids: string[]): number {
    const valid = ids.filter((id) => {
      const cfg = this.configs.find((c) => c.id === id)
      if (!cfg) return false
      if (this.running.has(id)) {
        logger.warn('queue', `${cfg.name} 正在执行，跳过重复入队`)
        return false
      }
      return true
    })
    for (const id of valid) {
      this.cancelled.delete(id)
      this.states.set(id, { configId: id, status: 'pending', progress: 0, message: '等待部署' })
      this.emitState(this.states.get(id) as TaskState)
    }
    if (valid.length > 0) {
      logger.info('queue', `入队 ${valid.length} 个部署任务: ${valid.join(', ')}`)
      void this.runBatch(valid)
    }
    return valid.length
  }

  /** 失败/需手动项重试（P2-4）：重置状态后重新走完整流水线 */
  retry(ids: string[]): number {
    const valid = ids.filter((id) => {
      const st = this.states.get(id)
      if (!st) return false
      if (this.running.has(id)) return false
      return st.status === 'failed' || st.status === 'manual-needed' || st.status === 'pending'
    })
    for (const id of valid) {
      this.cancelled.delete(id)
      this.states.set(id, { configId: id, status: 'pending', progress: 0, message: '等待重试' })
      this.emitState(this.states.get(id) as TaskState)
    }
    if (valid.length > 0) {
      logger.info('queue', `重试 ${valid.length} 个任务: ${valid.join(', ')}`)
      void this.runBatch(valid)
    }
    return valid.length
  }

  /** 取消等待中的任务（仅 pending 可取消），执行中返回 false */
  cancel(configId: string): boolean {
    const st = this.states.get(configId)
    if (!st) return false
    if (this.running.has(configId)) {
      const activeStatuses: TaskStatus[] = ['checking', 'downloading', 'installing', 'verifying']
      if (activeStatuses.includes(st.status)) {
        logger.warn('queue', `${configId} 正在执行，无法取消`)
        return false
      }
    }
    this.cancelled.add(configId)
    this.states.delete(configId)
    logger.info('queue', `已取消任务: ${configId}`)
    return true
  }

  private async runBatch(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.runOne(id)))
  }

  private async runOne(id: string): Promise<void> {
    const cfg = this.configs.find((c) => c.id === id)
    if (!cfg) return
    if (this.cancelled.has(id)) {
      this.cancelled.delete(id)
      return
    }
    this.running.add(id)
    const update: installer.UpdateFn = (patch) => {
      const cur = this.states.get(id)
      if (!cur) return
      const next: TaskState = { ...cur, ...patch, configId: id }
      this.states.set(id, next)
      this.emitState(next)
    }
    try {
      update({ status: 'checking', message: '解析下载源', progress: 0 })
      // 阶段一：解析 + 下载（并发 3）
      let p1: installer.Phase1
      await this.downloadSem.acquire()
      try {
        p1 = await installer.resolveAndDownload(cfg, update)
      } finally {
        this.downloadSem.release()
      }
      if (this.cancelled.has(id)) {
        this.cancelled.delete(id)
        return
      }
      if (!p1.ok) {
        update({ status: p1.status, progress: 0, message: p1.message })
        return
      }
      // 阶段二：安装 + 后置动作 + 校验（全局互斥）
      update({ status: 'installing', message: '等待安装队列', progress: 100 })
      await this.installMutex.acquire()
      let outcome: installer.InstallOutcome
      try {
        outcome = await installer.finishInstall(cfg, p1.filePath, update)
      } finally {
        this.installMutex.release()
      }
      const base =
        outcome.status === 'success'
          ? '部署完成'
          : outcome.status === 'manual-needed'
            ? '需手动完成安装（详见日志）'
            : '失败，可重试'
      const msg = outcome.note ? `${base}（${outcome.note}）` : base
      update({ status: outcome.status, message: msg })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      update({ status: 'failed', message })
      logger.error('task', `${cfg.name} 任务异常: ${err instanceof Error ? err.stack : String(err)}`)
    } finally {
      this.running.delete(id)
    }
  }
}

export const taskQueue = new TaskQueue()
