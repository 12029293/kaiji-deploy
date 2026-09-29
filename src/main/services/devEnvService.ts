/**
 * 开发环境模块：编排 installer + PATH/版本校验（P0-1 校验失败标红 + 写日志）。
 */
import { execPS } from '../core/shellRunner'
import { taskQueue } from '../core/taskQueue'
import { logger } from '../core/logger'
import { devEnvConfigs } from '../config/devEnv.config'
import type { TaskState } from '@shared/types'

class DevEnvService {
  /** 校验已装开发环境：逐项执行 verify.command，结果实时推送任务流 */
  async verifyAll(): Promise<TaskState[]> {
    const results: TaskState[] = []
    for (const cfg of devEnvConfigs) {
      const base = taskQueue.getState(cfg.id)
      const state: TaskState = {
        configId: cfg.id,
        status: 'verifying',
        progress: 100,
        message: `校验 ${cfg.name} …`,
        ...(base?.logFile ? { logFile: base.logFile } : {})
      }
      taskQueue.emitState(state)
      try {
        const res = await execPS(cfg.verify?.command ?? 'echo skip', { timeoutMs: 60_000 })
        const firstLine = (res.stdout || res.stderr).trim().split('\n')[0] ?? ''
        const ok = cfg.verify?.successPattern
          ? new RegExp(cfg.verify.successPattern, 'i').test(firstLine)
          : res.code === 0
        const final: TaskState = {
          ...state,
          status: ok ? 'success' : 'failed',
          message: ok
            ? `已安装：${firstLine}`
            : `未检测到或校验失败：${firstLine || '命令无输出（可能未安装或 PATH 未生效）'}`
        }
        taskQueue.emitState(final)
        results.push(final)
        logger.info('devenv', `${cfg.name} 校验${ok ? '通过' : '未通过'}: ${firstLine}`)
      } catch (err) {
        const final: TaskState = {
          ...state,
          status: 'failed',
          message: `校验命令执行失败: ${err instanceof Error ? err.message : String(err)}`
        }
        taskQueue.emitState(final)
        results.push(final)
        logger.error('devenv', `${cfg.name} 校验异常: ${String(err)}`)
      }
    }
    return results
  }
}

export const devEnvService = new DevEnvService()
