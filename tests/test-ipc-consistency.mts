/**
 * IPC 一致性三方比对（静态分析）：
 * renderer 实际调用 ⊆ preload 白名单（INVOKE_CHANNELS = 全部非事件通道）⊆ main 注册（registerIpc）。
 * 事件通道：main 推送 kd:event:task / kd:event:log ↔ preload 订阅 ↔ renderer 消费。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { SRC } from './helpers/bundle.mts'

function read(p: string): string {
  return fs.readFileSync(p, 'utf-8')
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

// ---------- shared/types.ts 通道清单 ----------
const typesSrc = read(path.join(SRC, 'shared/types.ts'))
const ipcBlock = typesSrc.slice(typesSrc.indexOf('export const IPC'), typesSrc.indexOf('export type IpcChannel'))
const channelDecls = [...ipcBlock.matchAll(/([A-Z_]+):\s*'(kd:[^']+)'/g)].map((m) => [m[1], m[2]] as const)
const allChannels = channelDecls.map(([, ch]) => ch)
const eventChannels = allChannels.filter((c) => c.startsWith('kd:event:'))
const invokeChannels = allChannels.filter((c) => !c.startsWith('kd:event:'))

// ---------- main 注册 ----------
const registerSrc = read(path.join(SRC, 'main/ipc/registerIpc.ts'))
const registered = new Set<string>()
for (const [, name, ch] of [...registerSrc.matchAll(/handle\(\s*IPC\.([A-Z_]+)\s*,/g)]) {
  const found = channelDecls.find(([n]) => n === name)
  assert.ok(found, `registerIpc 中的 IPC.${name} 未在 shared/types 定义`)
  registered.add(found[1])
}

// ---------- renderer 调用 ----------
const rendererFiles = walk(path.join(SRC, 'renderer')).filter((f) => /\.(tsx?|jsx?)$/.test(f))
const rendererCalls = new Set<string>()
for (const f of rendererFiles) {
  const src = read(f)
  for (const [, name] of src.matchAll(/IPC\.([A-Z_]+)/g)) {
    const found = channelDecls.find(([n]) => n === name)
    assert.ok(found, `renderer ${path.relative(SRC, f)} 使用未定义的 IPC.${name}`)
    rendererCalls.add(found[1])
  }
}

// ---------- preload 白名单 ----------
const preloadSrc = read(path.join(SRC, 'preload/index.ts'))
assert.match(preloadSrc, /INVOKE_CHANNELS\.includes\(channel\)/, 'preload 应做白名单校验')
assert.match(preloadSrc, /INVOKE_CHANNELS/)

test(`shared/types 定义 ${allChannels.length} 个通道，命名一律 kd:<域>:<动作>（ARCH 共享知识 #1）`, () => {
  assert.ok(allChannels.length >= 20, `通道数 ${allChannels.length}`)
  for (const ch of allChannels) {
    assert.match(ch, /^kd:[a-z]+:[a-zA-Z]+$/, `通道 ${ch} 命名不符合 kd:<域>:<动作>`)
  }
  assert.ok(channelDecls.every(([name]) => name === name.toUpperCase()))
})

test('renderer 调用的每个通道都在 main 注册（无悬空调用）', () => {
  const missing = [...rendererCalls].filter((ch) => !registered.has(ch))
  assert.deepEqual(missing, [], `renderer 调用但 main 未注册: ${missing.join(', ')}`)
})

test('renderer 调用通道 ⊆ preload 白名单（全部非事件通道即白名单）', () => {
  const illegal = [...rendererCalls].filter((ch) => eventChannels.includes(ch))
  assert.deepEqual(illegal, [], `renderer 不得调用事件通道: ${illegal.join(', ')}`)
  // renderer 调用的都是 invoke 通道
  for (const ch of rendererCalls) {
    assert.ok(invokeChannels.includes(ch), `${ch} 应在 INVOKE_CHANNELS 中`)
  }
})

test('main 注册的通道都在 shared/types 白名单内（禁止裸字符串注册）', () => {
  for (const ch of registered) {
    assert.ok(allChannels.includes(ch), `注册了未定义通道 ${ch}`)
  }
  // 禁止裸字符串 handle('kd:...')
  assert.doesNotMatch(registerSrc, /ipcMain\.handle\(\s*'/, '不得用裸字符串注册 IPC')
})

test(`通道覆盖统计：renderer 使用 ${rendererCalls.size} 个 invoke 通道；预留通道有注册`, () => {
  // 预留（注册但 renderer 未调用）的通道必须是已知集合
  // （v1.1.0：壁纸页改走 wallhaven 通道，wallpaper:list/thumb/set 保留注册供主进程内部链路）
  const reserved = invokeChannels.filter((ch) => registered.has(ch) && !rendererCalls.has(ch))
  const KNOWN_RESERVED = new Set([
    'kd:tasks:cancel',
    'kd:ime:cleanup',
    'kd:wallpaper:list',
    'kd:wallpaper:thumb',
    'kd:wallpaper:set'
  ])
  assert.deepEqual(
    reserved.filter((ch) => !KNOWN_RESERVED.has(ch)),
    [],
    `出现未知预留通道: ${reserved.join(', ')}`
  )
  // 关键通道必须在 renderer 调用集合中
  // （v1.1.0：壁纸页改走 wallhaven 通道，wallpaper:list/set 保留为预留通道由主进程内部使用）
  for (const must of [
    'kd:system:info', 'kd:tasks:run', 'kd:tasks:retry', 'kd:tasks:getAll',
    'kd:edge:status', 'kd:edge:closeEdge', 'kd:edge:customize',
    'kd:tools:action', 'kd:wallhaven:list', 'kd:wallhaven:set',
    'kd:onboard:get', 'kd:onboard:done', 'kd:apps:getConfigs'
  ]) {
    assert.ok(rendererCalls.has(must), `关键通道 ${must} 应被 renderer 使用`)
  }
  // v1.1.0：netbian 六通道必须彻底移除（定义 + 注册 + 调用三方均不得出现）
  for (const ban of allChannels) {
    assert.ok(!ban.includes('netbian'), `netbian 通道 ${ban} 应已移除`)
  }
  assert.doesNotMatch(registerSrc, /netbian/i, 'registerIpc 不得再注册 netbian')
})

test('事件通道三方一致：main 推送 ↔ preload 订阅 ↔ renderer 消费', () => {
  // main 侧推送
  const queueSrc = read(path.join(SRC, 'main/core/taskQueue.ts'))
  const loggerSrc = read(path.join(SRC, 'main/core/logger.ts'))
  assert.match(queueSrc, /IPC\.EVENT_TASK/, 'taskQueue 应推送 kd:event:task')
  assert.match(loggerSrc, /IPC\.EVENT_LOG/, 'logger 应推送 kd:event:log')
  // preload 订阅
  assert.match(preloadSrc, /IPC\.EVENT_TASK/, 'preload 应订阅任务事件')
  assert.match(preloadSrc, /IPC\.EVENT_LOG/, 'preload 应订阅日志事件')
  // renderer 消费（store 订阅 onTask/onLog）
  const tasksStore = read(path.join(SRC, 'renderer/src/store/tasksStore.ts'))
  const logStore = read(path.join(SRC, 'renderer/src/store/logStore.ts'))
  assert.match(tasksStore, /onTask/, 'tasksStore 应消费任务事件')
  assert.match(logStore, /onLog/, 'logStore 应消费日志事件')
})
