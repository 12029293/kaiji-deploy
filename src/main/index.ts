/**
 * 主进程入口：单实例锁 → 创建窗口 → requireAdministrator 校验 → 注册 IPC → 注册配置。
 */
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { app, BrowserWindow, dialog, Menu } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { IPC } from '@shared/types'
import { logger } from './core/logger'
import { settings } from './core/settings'
import { isElevated } from './core/shellRunner'
import { registerIpc } from './ipc/registerIpc'
import { dailyAppsService } from './services/dailyAppsService'

// v1.0.2：日志目录必须在任何 logger 调用之前用 userData 初始化，
// 否则日志会落到“进程 CWD\logs”（安装后 CWD 不确定）。
try {
  logger.initLogDir(app.getPath('userData'))
} catch {
  /* app.getPath 未就绪时由 logger 回退 CWD，不阻断启动 */
}

declare global {
  // eslint-disable-next-line no-var
  var kdUserData: string
}

// 单实例锁（避免两个实例同时操作注册表/下载缓存）
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  // 开发期 Perf 提示（electron-vite 模板标准做法）
  app.disableHardwareAcceleration = app.disableHardwareAcceleration // no-op 保持默认
  app.whenReady().then(async () => {
    // 自提权（exe 清单保持 asInvoker——requireAdministrator 清单会破坏 Chromium 子进程创建，
    // 实测 GPU 子进程 launch failed → 启动即崩；改为运行时检测 + UAC 重启自身）
    if (app.isPackaged && !(await isElevated())) {
      const choice = dialog.showMessageBoxSync({
        type: 'question',
        title: '开机部署助手',
        message:
          '本工具需要管理员权限才能执行系统级部署（注册表 / Edge 定制 / 系统工具）。\n是否以管理员身份重新启动？',
        buttons: ['以管理员重启', '暂不（部分功能受限）'],
        defaultId: 0,
        cancelId: 1
      })
      if (choice === 0) {
        const exe = process.execPath.replace(/'/g, "''")
        spawn(
          'powershell.exe',
          ['-NoProfile', '-Command', `Start-Process -FilePath '${exe}' -Verb RunAs`],
          { detached: true, stdio: 'ignore' }
        ).unref()
        app.quit()
        return
      }
      logger.warn('app', '用户选择以普通权限继续，部分功能受限')
    } else if (await isElevated()) {
      logger.info('app', '已以管理员权限运行')
    }

    // DevTools 扩展安装与生产环境快捷键收敛
    app.on('web-contents-created', (_e, contents) => {
      // 仅生产环境收敛 F12（开发环境保留调试）
      if (!app.isPackaged) return
      contents.on('before-input-event', (_event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
          ;(input as unknown as { preventDefault?: () => void }).preventDefault?.()
        }
      })
    })
    electronApp.setAppUserModelId('com.kaiji.deploy')
    app.on('browser-window-created', (_e, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // 初始化顺序：全局路径 → 设置 → IPC → 配置注册 → 窗口
    global.kdUserData = app.getPath('userData')
    settings.init(global.kdUserData)
    registerIpc()
    dailyAppsService.registerAll()

    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // Windows 部署工具：关窗即退出
    app.quit()
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1080,
    minHeight: 700,
    show: false,
    backgroundColor: '#0B1220',
    title: '开机部署助手',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // 渲染进程内的链接一律走外部浏览器，不在窗口内跳转
  win.webContents.setWindowOpenHandler((details) => {
    void import('electron').then(({ shell }) => shell.openExternal(details.url))
    return { action: 'deny' }
  })

  Menu.setApplicationMenu(null)

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // 未使用变量提示：IPC 常量在此仅用于确保三端通道一致性的引用锚点
  void IPC
}
