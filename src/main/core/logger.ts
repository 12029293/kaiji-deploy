/**
 * 日志总线：分级、时间戳、写 userData/logs/app-YYYYMMDD.log、推 renderer。
 * 格式：[YYYY-MM-DD HH:mm:ss] [LEVEL] [scope] text（ARCH 共享知识 #3）
 */
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import { IPC, type LogEntry } from '@shared/types'
import { getDesktopPath } from '../config/paths'

type Level = LogEntry['level']

/** 主进程全局 userData 目录（main/index.ts 启动时赋值） */
declare global {
  // eslint-disable-next-line no-var
  var kdUserData: string
}

class Logger {
  private todayKey = ''
  private logFile = ''
  /** 显式指定的日志目录（main/index.ts 最顶部用 app.getPath('userData') 初始化） */
  private dir = ''

  /**
   * 初始化日志目录（必须早于任何日志调用）。
   * 未初始化时回退 global.kdUserData，再回退进程 CWD（避免日志落到意外位置）。
   */
  initLogDir(dir: string): void {
    if (!dir) return
    this.dir = dir
    this.logFile = ''
    this.todayKey = ''
  }

  private baseDir(): string {
    return this.dir || global.kdUserData || process.cwd()
  }

  private stamp(): string {
    const d = new Date()
    const pad = (n: number): string => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  }

  private ensureFile(): string {
    const now = new Date()
    const key = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    if (!this.logFile || key !== this.todayKey) {
      const dir = path.join(this.baseDir(), 'logs')
      fs.mkdirSync(dir, { recursive: true })
      this.logFile = path.join(dir, `app-${key}.log`)
      this.todayKey = key
    }
    return this.logFile
  }

  private emit(level: Level, scope: string, text: string): void {
    const entry: LogEntry = { ts: this.stamp(), level, scope, text }
    const line = `[${entry.ts}] [${level.toUpperCase()}] [${scope}] ${text}`
    try {
      fs.appendFileSync(this.ensureFile(), line + '\n', 'utf-8')
    } catch {
      /* 磁盘异常不阻塞主流程 */
    }
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.EVENT_LOG, entry)
      }
    }
  }

  info(scope: string, text: string): void {
    this.emit('info', scope, text)
  }

  warn(scope: string, text: string): void {
    this.emit('warn', scope, text)
  }

  error(scope: string, text: string): void {
    this.emit('error', scope, text)
  }

  getLogFile(): string {
    return this.ensureFile()
  }

  /** 导出日志 txt 到用户选择位置（P2-3），返回保存路径（取消返回空串） */
  async exportTxt(): Promise<string> {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出部署日志',
      defaultPath: path.join(getDesktopPath(), `部署日志-${new Date().toISOString().slice(0, 10)}.txt`),
      filters: [{ name: 'Text', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return ''
    try {
      fs.copyFileSync(this.getLogFile(), filePath)
      this.info('logger', `日志已导出: ${filePath}`)
    } catch (err) {
      this.error('logger', `日志导出失败: ${String(err)}`)
    }
    return filePath
  }
}

export const logger = new Logger()
