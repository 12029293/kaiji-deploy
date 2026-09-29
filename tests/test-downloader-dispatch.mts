/**
 * 下载器 dispatcher 选择测试（v1.1.0 改动一）：
 * Python 下载事故根因 = 代理 dispatcher 被无条件套用到所有下载候选，
 * 本机代理对 python.org 33MB 流式响应中途掐断（SocketError: other side closed）。
 * 修复 = buildAttempts 按「直连优先域名 × 代理开关」生成尝试序列：
 * - 代理关：仅直连；
 * - 代理开 + python.org/dl.google.com/nodejs.org（url-resolver 结果）→ 直连优先，代理兜底；
 * - 代理开 + 其它域名（GitHub 等被墙源）→ 代理优先，直连兜底；
 * - 每个 URL 保留 https → http 协议回退。
 * 真实 downloader.ts 打包（logger/settings 桩），不发出任何网络请求 —— 只测纯函数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { bundleModule, hooks } from './helpers/bundle.mts'

// bundle 落在项目 node_modules 内，保证 'undici' 裸导入可解析（external 保留真实模块），
// 且不污染项目根（与 test-downloader-decode 同一约定）
const tmpOut = path.join(process.cwd(), 'node_modules', '.kdtest-dispatch')
fs.mkdirSync(tmpOut, { recursive: true })
process.env.KD_TMP_USERDATA = process.env.KD_TMP_USERDATA ?? tmpOut
hooks() // 初始化全局桩钩子（bundle 内桩模块 import 时捕获）

const mod = await bundleModule(path.join(process.cwd(), 'src/main/core/downloader.ts'), {
  tmpOut,
  name: 'downloader',
  externals: ['undici']
})
const dl = (await import(mod)) as {
  buildAttempts: (
    url: string,
    mirrors: string[] | undefined,
    proxyUrl: string | null
  ) => Array<{ url: string; mode: 'proxy' | 'direct' }>
  isDirectFirstHost: (url: string) => boolean
  cachedPath: (cacheDir: string, url: string, filename: string) => string
}

const PY = 'https://www.python.org/ftp/python/3.14.7/python-3.14.7-amd64.exe'
const GH = 'https://github.com/git-for-windows/git/releases/download/v2.56.0/Git-2.56.0-64-bit.exe'

test('isDirectFirstHost：直连优先域名白名单命中与未命中', () => {
  assert.equal(dl.isDirectFirstHost(PY), true, 'python.org 应直连优先')
  assert.equal(dl.isDirectFirstHost('http://dl.google.com/go/go1.24.msi'), true)
  assert.equal(dl.isDirectFirstHost('https://nodejs.org/dist/node.msi'), true)
  assert.equal(dl.isDirectFirstHost(GH), false, 'GitHub 不在直连优先名单')
  assert.equal(dl.isDirectFirstHost('not a url'), false, '非法 URL 按非白名单处理')
})

test('buildAttempts：代理未开启 → 仅直连（不生成代理尝试）', () => {
  const attempts = dl.buildAttempts(PY, undefined, null)
  // https 主 URL + http 协议回退，全部直连
  assert.deepEqual(attempts, [
    { url: PY, mode: 'direct' },
    { url: 'http://www.python.org/ftp/python/3.14.7/python-3.14.7-amd64.exe', mode: 'direct' }
  ])
})

test('buildAttempts：代理开启 + python.org → 直连优先，代理兜底（事故修复核心）', () => {
  const attempts = dl.buildAttempts(PY, undefined, 'http://127.0.0.1:7897')
  // 尝试顺序：https 直连 → https 代理 → http 直连 → http 代理（每个变体内部直连优先）
  assert.deepEqual(attempts, [
    { url: PY, mode: 'direct' },
    { url: PY, mode: 'proxy' },
    { url: 'http://www.python.org/ftp/python/3.14.7/python-3.14.7-amd64.exe', mode: 'direct' },
    { url: 'http://www.python.org/ftp/python/3.14.7/python-3.14.7-amd64.exe', mode: 'proxy' }
  ])
})

test('buildAttempts：代理开启 + GitHub → 代理优先，直连兜底', () => {
  const attempts = dl.buildAttempts(GH, undefined, 'http://127.0.0.1:7897')
  assert.deepEqual(attempts, [
    { url: GH, mode: 'proxy' },
    { url: GH, mode: 'direct' },
    {
      url: 'http://github.com/git-for-windows/git/releases/download/v2.56.0/Git-2.56.0-64-bit.exe',
      mode: 'proxy'
    },
    {
      url: 'http://github.com/git-for-windows/git/releases/download/v2.56.0/Git-2.56.0-64-bit.exe',
      mode: 'direct'
    }
  ])
})

test('buildAttempts：https 主 URL 保留 http 协议回退（IDM 历史修复不回退）', () => {
  const attempts = dl.buildAttempts(PY, undefined, 'http://127.0.0.1:7897')
  const urls = attempts.map((a) => a.url)
  assert.ok(urls.includes('http://www.python.org/ftp/python/3.14.7/python-3.14.7-amd64.exe'), '应有 http 变体')
  assert.equal(attempts.length, 4, 'https/http × direct/proxy = 4 次尝试')
  // http 变体同样直连优先（python.org）
  const httpVariants = attempts.filter((a) => a.url.startsWith('http://'))
  assert.equal(httpVariants[0].mode, 'direct')
})

test('buildAttempts：镜像候选逐个展开且各含 dispatcher 回退', () => {
  const mirror = 'https://mirror.example.com/python.exe'
  const attempts = dl.buildAttempts(PY, [mirror], 'http://127.0.0.1:7897')
  // python.org https/http × 直连优先 2 模式 = 4；镜像 https/http × 代理优先 2 模式 = 4
  assert.equal(attempts.length, 8)
  assert.deepEqual(attempts.slice(0, 2), [
    { url: PY, mode: 'direct' },
    { url: PY, mode: 'proxy' }
  ])
  assert.deepEqual(attempts.slice(4, 6), [
    { url: mirror, mode: 'proxy' },
    { url: mirror, mode: 'direct' }
  ])
})

test('buildAttempts：http 主 URL 不追加 http:// 变体（避免重复）', () => {
  const httpUrl = 'http://download.videolan.org/vlc/3.0.21/win64/vlc-3.0.21-win64.exe'
  const attempts = dl.buildAttempts(httpUrl, undefined, 'http://127.0.0.1:7897')
  assert.deepEqual(attempts, [
    { url: httpUrl, mode: 'proxy' },
    { url: httpUrl, mode: 'direct' }
  ])
})

test('cachedPath：sha1(url) 缓存键不回归', () => {
  const p = dl.cachedPath('C:\\cache', PY, 'python.exe')
  const key = (p as string).split(path.sep).pop() ?? ''
  assert.match(key, /^[0-9a-f]{40}-python\.exe$/)
})
