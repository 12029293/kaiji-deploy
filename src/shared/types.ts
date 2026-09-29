/**
 * 共享类型定义 —— 主进程 / 预加载 / 渲染进程三端共用。
 * 所有 IPC 通道常量统一在此导出，禁止裸字符串（ARCH 共享知识 #1）。
 */

/* ---------------- 任务状态机（ARCH §3.2） ---------------- */

export type TaskStatus =
  | 'pending'
  | 'checking'
  | 'downloading'
  | 'installing'
  | 'verifying'
  | 'success'
  | 'manual-needed'
  | 'failed'

export interface TaskState {
  configId: string
  status: TaskStatus
  /** 0-100，仅下载阶段有实际意义 */
  progress: number
  /** 当前步骤描述 / 错误信息 */
  message: string
  exitCode?: number
  logFile?: string
}

/* ---------------- 安装配置 Schema（ARCH §3.1） ---------------- */

export type SourceKind = 'local-file' | 'direct-url' | 'url-resolver' | 'github-release' | 'none'
export type Category = 'devenv' | 'daily' | 'proxy'
export type DegradeMode = 'wizard' | 'browser' | 'none'

export interface SourceSpec {
  kind: SourceKind
  /** kind=local-file：素材目录相对路径 */
  localPath?: string
  /** kind=direct-url：固定直链 */
  url?: string
  /** kind=url-resolver：解析器名（注册在 *.config.ts 的 resolverRegistry 中） */
  resolver?: string
  /** kind=github-release：GitHub 仓库 owner/name */
  repo?: string
  /** kind=github-release：资产匹配正则（字符串形式，new RegExp(pattern, 'i')） */
  assetPattern?: string
}

export type PostAction =
  | { type: 'set-autostart'; runKey: string }
  | { type: 'cleanup-ime' }
  | { type: 'run-command'; command: string; elevated?: boolean }
  | { type: 'add-path'; dir: string }
  | { type: 'create-shortcut' }

/** 桌面快捷方式规格（v1.0.2）：显式覆盖自动定位结果 */
export interface ShortcutSpec {
  /** 目标 exe / 脚本绝对路径（缺省时由工具自动定位主程序） */
  target?: string
  /**
   * 额外启动参数。脚本目标（.ps1/.cmd/.bat/.vbs/.js）无需填 —— 工具会自动以
   * `powershell.exe -ExecutionPolicy Bypass -File "<脚本>"` 方式启动，此处只放传给脚本的附加参数。
   */
  args?: string
  /** 快捷方式显示名（缺省用配置 name） */
  name?: string
  /** 工作目录（缺省取目标所在目录） */
  workDir?: string
}

export interface VerifySpec {
  /** PowerShell 执行的校验命令，如 'go version' */
  command: string
  /** 输出匹配正则（字符串形式），匹配即通过；缺省时代码 0 即通过 */
  successPattern?: string
}

export interface InstallConfig {
  /** 唯一 ID，如 'wechat' / 'go' */
  id: string
  name: string
  category: Category
  source: SourceSpec
  /** 下载落盘目录：cache=应用缓存目录 / desktop=桌面（P0-7：Geek/IDM破解） */
  downloadDir?: 'cache' | 'desktop'
  /** 下载后重命名的最终文件名（如 'IDM破解.exe'） */
  renameTo?: string
  /** 静默参数；**undefined 表示纯下载任务（不执行安装）**，'' 表示无参运行 */
  silentArgs?: string
  /** zip 解压目标目录（如动漫共和国） */
  extractZip?: string
  /**
   * 解压后若目录内含安装器则自动静默执行（v1.0.2 修复 A）。
   * 动漫共和国：官网 zip 里是 NSIS 安装器本体（32 位外壳包 64 位载荷），
   * 只解压不执行 = 用户拿到“装着安装器的文件夹”，软件根本没装上。
   */
  runExtractedInstaller?: {
    /** 匹配安装器 basename 的正则字符串（i 标志），如 'setup.*\\.exe$' */
    pattern: string
    /** 传给该安装器的静默参数（NSIS 用 '/S'） */
    silentArgs: string
    /** 安装目录参数风格，默认 'nsis' */
    installDirStyle?: 'nsis' | 'inno' | 'msi' | 'none'
  }
  postActions?: PostAction[]
  verify?: VerifySpec
  /** 静默失败降级：wizard=打开本地安装包向导 / browser=打开官网 / none=仅标失败 */
  degrade: DegradeMode
  /**
   * degrade=wizard 且安装器自身会弹 GUI（引导器形态，如向日葵）时为 true：
   * 失败后只标 manual-needed，**不再** shell.openPath 打开安装包，避免二次弹窗（v1.0.2 修复）。
   */
  wizardSelfLaunched?: boolean
  /** degrade=wizard 时优先打开的本地安装包路径 */
  wizardPath?: string
  /** degrade=browser 时的官网 URL */
  homepage?: string
  /** degrade=browser 时给用户的降级说明（如官方风控需人工过验证码） */
  manualHint?: string
  /** 桌面快捷方式覆盖规格（v1.0.2） */
  shortcut?: ShortcutSpec
  /** 危险操作，renderer 侧需二次确认 */
  needsConfirm?: boolean
}

/* ---------------- IPC 通道常量（ARCH §3.3，命名 kd:<域>:<动作>） ---------------- */

export const IPC = {
  SYSTEM_INFO: 'kd:system:info',
  TASKS_RUN: 'kd:tasks:run',
  TASKS_RETRY: 'kd:tasks:retry',
  TASKS_CANCEL: 'kd:tasks:cancel',
  TASKS_GET_ALL: 'kd:tasks:getAll',
  /** 扩展通道：渲染进程获取软件配置清单（ARCH 表外扩展，见交付说明） */
  APPS_GET_CONFIGS: 'kd:apps:getConfigs',
  EVENT_TASK: 'kd:event:task',
  EVENT_LOG: 'kd:event:log',
  DEVENV_VERIFY_ALL: 'kd:devenv:verifyAll',
  PROXY_GET_SETTINGS: 'kd:proxy:getSettings',
  PROXY_SET_SETTINGS: 'kd:proxy:setSettings',
  PROXY_FETCH_RELEASES: 'kd:proxy:fetchReleases',
  EDGE_STATUS: 'kd:edge:status',
  EDGE_CLOSE: 'kd:edge:closeEdge',
  EDGE_CUSTOMIZE: 'kd:edge:customize',
  EDGE_PREVIEW: 'kd:edge:previewBookmarks',
  IME_CLEANUP: 'kd:ime:cleanup',
  TOOLS_ACTION: 'kd:tools:action',
  WALLPAPER_LIST: 'kd:wallpaper:list',
  WALLPAPER_THUMB: 'kd:wallpaper:thumb',
  WALLPAPER_SET: 'kd:wallpaper:set',
  /** Wallhaven 在线壁纸（v1.0.9；v1.1.0 起为唯一在线壁纸来源）：列表 / 缩略图 / 下载并设壁纸 */
  WALLHAVEN_LIST: 'kd:wallhaven:list',
  WALLHAVEN_THUMB: 'kd:wallhaven:thumb',
  WALLHAVEN_SET: 'kd:wallhaven:set',
  ONBOARD_GET: 'kd:onboard:get',
  ONBOARD_DONE: 'kd:onboard:done',
  PLAN_SAVE: 'kd:plan:save',
  PLAN_LOAD: 'kd:plan:load',
  LOG_EXPORT: 'kd:log:export',
  /** 全局安装选项（v1.0.2）：桌面快捷方式 / 开机启动 */
  OPTIONS_GET: 'kd:options:get',
  OPTIONS_SET: 'kd:options:set'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

/* ---------------- DTO ---------------- */

/** 所有 invoke 返回的统一包装（ARCH 共享知识 #4） */
export interface ApiResponse<T> {
  ok: boolean
  data?: T
  error?: string
}

export interface SystemInfo {
  os: string
  arch: string
  isAdmin: boolean
  desktopPath: string
}

export interface ProxySettings {
  enabled: boolean
  host: string
  port: number
}

/** 全局安装选项（v1.0.2） */
export interface InstallOptions {
  /** 安装/解压完成后创建桌面快捷方式（默认 true） */
  createShortcut: boolean
  /** 是否写入开机自启（默认 false，用户明确要求不设开机启动） */
  setAutostart: boolean
}

export interface ReleaseAsset {
  name: string
  size: number
  url: string
}

export interface ReleaseInfo {
  id: string
  name: string
  latestVersion: string
  assets: ReleaseAsset[]
  /** 拉取失败时给出错误，其余字段为空 */
  error?: string
}

export interface AppConfigView {
  id: string
  name: string
  category: Category
  homepage?: string
  degrade: DegradeMode
  needsConfirm?: boolean
  /** 部署来源摘要（卡片副标题展示） */
  sourceHint: string
}

export type ToolAction =
  | 'badge-remove'
  | 'shield-remove'
  | 'badge-restore'
  | 'shield-restore'
  | 'rebuild-icon-cache'
  | 'tiles'
  | 'activation'
  | 'disable-update'
  | 'enable-update'

export interface ToolResult {
  ok: boolean
  output: string
}

export interface EdgeCustomizeOptions {
  favorites: boolean
  dark: boolean
  downloadDir: boolean
}

export interface EdgeCustomizeResult {
  ok: boolean
  details: string[]
}

export interface BookmarkPreview {
  folders: number
  links: number
}

export interface WallpaperItem {
  name: string
  path: string
  isStatic: boolean
}

/** Wallhaven 列表项（v1.0.9，≥1920x1080 过滤后） */
export interface WallhavenPhoto {
  id: string
  resW: number
  resH: number
  /** 缩略图直链（thumbs.large，th.wallhaven.cc） */
  thumbUrl: string
  /** 原图直链（data[].path，w.wallhaven.cc，无需 Referer/UA/Cookie） */
  origUrl: string
}

/** Wallhaven 列表页（v1.1.0 修复三：带分页 meta，UI 据此渲染「第 N 页 / 共 M 页」） */
export interface WallhavenPage {
  photos: WallhavenPhoto[]
  /** 服务端确认的当前页码（meta.current_page，缺省回退请求页码） */
  page: number
  /** 服务端确认的末页（meta.last_page；缺失时按越界判空兜底推算） */
  lastPage: number
}

/** Wallhaven 下载并设壁纸结果（v1.1.0：移除 no-proxy，网络失败展示真实错误） */
export interface WallhavenDownloadResult {
  ok: boolean
  message: string
  reason?: 'too-small' | 'parse-failed' | 'set-failed' | 'network'
  /** 成功时为落盘的原图路径 */
  path?: string
}

export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  scope: string
  text: string
}

/* ---------------- 日志事件通道辅助 ---------------- */

/** 渲染进程可调用的 invoke 通道白名单（preload 校验用） */
export const INVOKE_CHANNELS: string[] = Object.values(IPC).filter(
  (c) => !c.startsWith('kd:event:')
) as string[]

/** 主进程 → 渲染进程事件通道 */
export const EVENT_CHANNELS: string[] = ['kd:event:task', 'kd:event:log']
