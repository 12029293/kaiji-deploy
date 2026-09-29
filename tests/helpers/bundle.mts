/**
 * 测试辅助：用 esbuild 将 TS 源码模块打包为可独立运行的 ESM，
 * 对 electron / logger / settings / shellRunner / downloader / paths 等宿主依赖做桩替换。
 * 捕获的桩调用通过 globalThis.__kdHooks 交换给测试断言。
 */
import { build } from 'esbuild'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const PROJ = path.resolve(import.meta.dirname, '..', '..')
export const SRC = path.join(PROJ, 'src')
export const ASSET_ROOT = 'C:\\Users\\Administrator\\Desktop\\开机部署'

/** 每个 bundle 独立的临时输出目录 */
export function makeTmpDir(prefix = 'kdtest-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

/** 全局桩钩子（bundle 内的桩模块写入，测试文件读取） */
export function hooks(): {
  commands: Array<{ cmd: string; args: string[]; kind: string; code: number; stdout: string; stderr: string }>
  shell: { openExternal: string[]; openPath: string[] }
  imeCleanups: number
  downloads: string[]
  wallpaperSets: string[]
  // 行为控制：execCmd/execPS 返回值与延迟
  behavior: { cmdCode: number; psCode: number; psStdout: string; cmdStdout: string; delayMs: number; trackConcurrency: boolean; maxConcurrent: number; downloadDelayMs: number; concurrentDownloads: number }
  reset(): void
} {
  const g = globalThis as Record<string, unknown>
  if (!g.__kdHooks) {
    g.__kdHooks = {
      commands: [],
      shell: { openExternal: [], openPath: [] },
      imeCleanups: 0,
      downloads: [],
      wallpaperSets: [],
      behavior: {
        cmdCode: 0,
        psCode: 0,
        psStdout: '',
        cmdStdout: '',
        delayMs: 0,
        trackConcurrency: false,
        maxConcurrent: 0,
        downloadDelayMs: 0,
        concurrentDownloads: 0
      },
      reset(): void {
        this.commands.length = 0
        this.shell.openExternal.length = 0
        this.shell.openPath.length = 0
    this.imeCleanups = 0
    this.downloads.length = 0
    this.wallpaperSets.length = 0
        this.behavior.cmdCode = 0
        this.behavior.psCode = 0
        this.behavior.psStdout = ''
        this.behavior.cmdStdout = ''
        this.behavior.delayMs = 0
        this.behavior.trackConcurrency = false
        this.behavior.maxConcurrent = 0
        this.behavior.downloadDelayMs = 0
        this.behavior.concurrentDownloads = 0
      }
    }
  }
  return g.__kdHooks as never
}

function stubElectron(): string {
  return `
const h = globalThis.__kdHooks
export const app = {
  isPackaged: false,
  getPath: (n) => process.env.KD_TMP_USERDATA || '.',
  requestSingleInstanceLock: () => true,
  whenReady: async () => {},
  on: () => {},
  quit: () => {}
}
export const BrowserWindow = { getAllWindows: () => [] }
export const shell = {
  openExternal: async (u) => { h.shell.openExternal.push(u) },
  openPath: async (p) => { h.shell.openPath.push(p); return '' }
}
export const dialog = {}
export const nativeImage = {}
export const Menu = { setApplicationMenu: () => {} }
`
}

function stubShellRunner(): string {
  return `
const h = globalThis.__kdHooks
async function fakeExec(kind, command, args, opts = {}) {
  const b = h.behavior
  if (b.trackConcurrency) {
    // 进程级并发计数（安装互斥 / 下载并发无法共享计数，这里只跟踪 shell 调用）
  }
  if (b.delayMs > 0) await new Promise((r) => setTimeout(r, b.delayMs))
  const rec = { cmd: command, args, kind, code: kind === 'ps' ? b.psCode : b.cmdCode,
    stdout: kind === 'ps' ? b.psStdout : b.cmdStdout, stderr: '' }
  h.commands.push(rec)
  return rec
}
export async function execCmd(command, opts) { return fakeExec('cmd', command, [], opts) }
export async function execPS(command, opts) { return fakeExec('ps', command, [], opts) }
export async function runAs(command, opts) { return fakeExec('runas', command, [], opts) }
export async function isElevated() { return true }
`
}

function stubLogger(): string {
  return `
export const logger = {
  info: () => {}, warn: () => {}, error: () => {},
  exportTxt: async () => ''
}
`
}

function stubSettings(): string {
  return `
export const settings = {
  _data: { cacheEnabled: false, proxy: { enabled: false, host: '127.0.0.1', port: 7897 }, onboardingDone: false, plan: {}, createShortcut: true, setAutostart: false },
  init() {},
  get() {
    // 允许测试通过 globalThis.__kdCacheEnabled 动态控制缓存开关（P2-2）
    const flag = globalThis.__kdCacheEnabled
    // 允许测试通过 globalThis.__kdSettingsOverrides 覆盖任意字段（v1.0.2：createShortcut / setAutostart）
    const override = globalThis.__kdSettingsOverrides || {}
    return { ...this._data, cacheEnabled: flag !== undefined ? flag : this._data.cacheEnabled, ...override }
  },
  set(patch) { Object.assign(this._data, patch); return this._data },
  proxyUrl() {
    // 允许测试通过 globalThis.__kdProxyOverride 强制代理开/关（v1.0.9：wallhaven）
    const o = globalThis.__kdProxyOverride
    if (o !== undefined) return o
    return this._data.proxy.enabled ? 'http://127.0.0.1:' + this._data.proxy.port : null
  }
}
`
}

function stubDownloader(): string {
  return `
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
const h = globalThis.__kdHooks
// v1.0.9：允许测试注入自定义解析响应（__kdFetcher.text/json/head），未注入则按桩报错
export async function fetchText(url, timeoutMs, headers) {
  const f = globalThis.__kdFetcher
  if (f && f.text) return f.text(url, headers || {})
  throw new Error('stub fetchText: ' + url)
}
export async function fetchJson(url, timeoutMs, headers) {
  const f = globalThis.__kdFetcher
  if (f && f.json) return f.json(url, headers || {})
  throw new Error('stub fetchJson: ' + url)
}
export async function postJson(url) { throw new Error('stub postJson: ' + url) }
export async function resolveLocation(url) { throw new Error('stub resolveLocation: ' + url) }
export async function headOk(url, timeoutMs, headers) {
  const f = globalThis.__kdFetcher
  if (f && f.head) return f.head(url, headers || {})
  return false
}
export function cachedPath(cacheDir, url, filename) {
  const key = crypto.createHash('sha1').update(url).digest('hex')
  return path.join(cacheDir, key + '-' + filename)
}
export async function downloadToFile(url, dest, opts = {}) {
  h.downloads.push(url)
  const b = h.behavior
  if (b.downloadDelayMs > 0) {
    b.concurrentDownloads++
    if (b.concurrentDownloads > b.maxConcurrent) b.maxConcurrent = b.concurrentDownloads
    await new Promise((r) => setTimeout(r, b.downloadDelayMs))
    b.concurrentDownloads--
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, 'stub-binary-' + url)
  opts.onProgress?.({ percent: 50, received: 1, total: 2 })
  opts.onProgress?.({ percent: 100, received: 2, total: 2 })
  return dest
}
export function currentDispatcher() {
  // v1.0.9：与 __kdProxyOverride 联动（代理开启返回哨兵对象供 wallhaven 透传给打桩 fetch）
  return globalThis.__kdProxyOverride ? { __stubDispatcher: true } : undefined
}
`
}

function stubPaths(tmp: { cache: string; desktop: string; assets: string; edgeBookmarks: string; edgePrefs: string; edgeHtml: string; installRoot?: string }): string {
  return `
import path from 'node:path'
const P = ${JSON.stringify(tmp)}
export function getAssetRoot() { return P.assets }
export function getAssetPath(...segs) { return path.join(P.assets, ...segs) }
export function getDesktopPath() { return P.desktop }
export function getCacheDir() { return P.cache }
export function getInstallRoot() { return P.installRoot || 'D:\\\\Apps' }
export function getEdgeDefaultDir() { return path.dirname(P.edgeBookmarks) }
export function getEdgeBookmarksPath() { return P.edgeBookmarks }
export function getEdgePreferencesPath() { return P.edgePrefs }
export function getBookmarkSourceHtml() { return P.edgeHtml }
`
}

function stubProxyService(): string {
  return `
export const proxyService = {}
export async function resolveGithubAsset(repo, pattern, proxy) {
  return { url: 'https://gh/' + repo + '/asset.exe', filename: 'asset.exe' }
}
`
}

function stubImeService(): string {
  return `
const h = globalThis.__kdHooks
export const imeService = { cleanup: async () => { h.imeCleanups++; return { removed: ['stub-ime'] } } }
`
}

function stubWallpaperService(): string {
  return `
const h = globalThis.__kdHooks
export const wallpaperService = {
  list: () => [],
  thumb: () => '',
  setWallpaper: async (p) => { h.wallpaperSets.push(p); return true }
}
`
}

const STUB_FACTORIES: Record<string, (...a: never[]) => string> = {
  electron: stubElectron as never,
  shellRunner: stubShellRunner as never,
  logger: stubLogger as never,
  settings: stubSettings as never,
  downloader: stubDownloader as never,
  proxyService: stubProxyService as never,
  imeService: stubImeService as never,
  wallpaperService: stubWallpaperService as never
}

export interface PathsFixture {
  cache: string
  desktop: string
  assets: string
  edgeBookmarks: string
  edgePrefs: string
  edgeHtml: string
  /** 非开发环境软件安装根目录（缺省 D:\Apps） */
  installRoot?: string
}

/** 把 src 内的相对依赖说明映射为桩种类：specifier → stub key */
const SPEC_TO_STUB: Array<[RegExp, string]> = [
  [/^electron$/, 'electron'],
  [/core\/shellRunner$/, 'shellRunner'],
  [/core\/logger$/, 'logger'],
  [/core\/settings$/, 'settings'],
  [/core\/downloader$/, 'downloader'],
  [/services\/proxyService$/, 'proxyService'],
  [/services\/imeService$/, 'imeService'],
  [/^(?:\.\/|services\/)wallpaperService$/, 'wallpaperService']
]

/**
 * 打包 TS 模块为独立 ESM 文件并返回输出路径。
 * pathsFixture 提供时替换 ../config/paths 桩；否则保留真实 paths（仍会替换其 electron 依赖）。
 */
export async function bundleModule(
  entryAbs: string,
  opts: { tmpOut: string; name: string; pathsFixture?: PathsFixture; externals?: string[] }
): Promise<string> {
  const { tmpOut, name, pathsFixture } = opts
  const outfile = path.join(tmpOut, `${name}.mjs`)

  const stubPlugin = {
    name: 'kd-stubs',
    setup(b: { onResolve: (o: object, cb: (a: object) => object) => void; onLoad: (o: object, cb: (a: object) => object) => void }): void {
      b.onResolve({ filter: /(^electron$)|(\.\/shellRunner)|(core\/shellRunner)|(core\/logger)|(core\/settings)|(core\/downloader)|(services\/proxyService)|(services\/imeService)|(\.\/wallpaperService)|(services\/wallpaperService)|(config\/paths)/ }, (args) => {
        for (const [re, key] of SPEC_TO_STUB) {
          if (re.test(args.path)) return { path: `__stub_${key}`, namespace: 'stub' }
        }
        if (args.path.endsWith('config/paths')) {
          if (pathsFixture) return { path: '__stub_paths', namespace: 'stub' }
          // 保留真实 paths（其中 electron 导入由 electron 桩接住）
          return null
        }
        return null
      })
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => {
        const key = args.path.replace('__stub_', '')
        if (key === 'paths') {
          if (!pathsFixture) throw new Error('paths fixture missing')
          return { contents: stubPaths(pathsFixture), loader: 'js' }
        }
        return { contents: STUB_FACTORIES[key](), loader: 'js' }
      })
    }
  }

  await build({
    entryPoints: [entryAbs],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
    external: ['node:*', ...(opts.externals ?? [])],
    alias: { '@shared': path.join(SRC, 'shared') },
    plugins: [stubPlugin as never],
    logLevel: 'silent'
  })
  return pathToFileURL(outfile).href
}
