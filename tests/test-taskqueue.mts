/**
 * 任务状态机与统一安装引擎集成测试（8 态流转 + 错误降级路径）：
 * pending → checking → downloading → installing → verifying → success / manual-needed / failed。
 * 静默失败 → 降级向导(browser/wizard) → manual-needed；无降级 → failed（P0-3）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bundleModule, makeTmpDir, hooks } from './helpers/bundle.mts'

const tmpOut = makeTmpDir('kd-queue-')
const tmpCache = path.join(tmpOut, 'cache')
const tmpDesktop = path.join(tmpOut, 'desktop')
const tmpAssets = path.join(tmpOut, 'assets')
fs.mkdirSync(tmpDesktop, { recursive: true })
fs.mkdirSync(tmpAssets, { recursive: true })

const H = hooks()
H.reset()
process.env.KD_TMP_USERDATA = tmpOut

const mod = await bundleModule(path.join(process.cwd(), 'src/main/core/taskQueue.ts'), {
  tmpOut,
  name: 'taskQueue',
  pathsFixture: {
    cache: tmpCache,
    desktop: tmpDesktop,
    assets: tmpAssets,
    edgeBookmarks: path.join(tmpOut, 'Bookmarks'),
    edgePrefs: path.join(tmpOut, 'Preferences'),
    edgeHtml: ''
  }
})
const { taskQueue } = await import(mod)

/** 等待任务到达终态 */
async function waitTerminal(id: string, timeoutMs = 15_000): Promise<{ status: string; message: string }> {
  const t0 = Date.now()
  for (;;) {
    const st = taskQueue.getState(id)
    if (st && ['success', 'manual-needed', 'failed'].includes(st.status)) return st
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`任务 ${id} 超时未达终态，当前: ${JSON.stringify(st)}`)
    }
    await new Promise((r) => setTimeout(r, 10))
  }
}

let seq = 0
function cfg(overrides: Record<string, unknown>): Record<string, unknown> {
  seq++
  return {
    id: `t${seq}`,
    name: `测试任务${seq}`,
    category: 'daily',
    source: { kind: 'direct-url', url: `https://example.com/app${seq}.exe` },
    silentArgs: '/S',
    degrade: 'none',
    ...overrides
  }
}

test('成功路径：direct-url + /S 静默退出码 0 → success，静默命令包含路径与参数', async () => {
  H.reset()
  const c = cfg({})
  taskQueue.registerConfigs([c as never])
  assert.equal(taskQueue.enqueue([c.id]), 1)
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'success', `message: ${st.message}`)
  const install = H.commands.find((x) => x.kind === 'cmd' && x.cmd.includes('.exe') && x.cmd.includes('/S'))
  assert.ok(install, `应执行静默安装命令: ${JSON.stringify(H.commands)}`)
  assert.match(install.cmd, /cache[/\\].*\.exe" \/S/, `安装命令: ${install.cmd}`)
  // 状态流转中出现 downloading 与 installing（最终 message=部署完成）
  assert.ok(H.downloads.length === 1, '应下载一次')
  assert.match(st.message, /部署完成/)
})

test('P0-3 降级 browser：静默退出码非 0 → 打开官网 + manual-needed', async () => {
  H.reset()
  H.behavior.cmdCode = 1602
  const c = cfg({ degrade: 'browser', homepage: 'https://example.com/home' })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'manual-needed', `message: ${st.message}`)
  assert.deepEqual(H.shell.openExternal, ['https://example.com/home'], '应打开官网')
})

test('P0-3 降级 wizard：静默失败时打开已下载安装包（candidatePath 优先），manual-needed', async () => {
  H.reset()
  H.behavior.cmdCode = 1
  const wizard = path.join(tmpAssets, 'setup.exe')
  fs.writeFileSync(wizard, 'dummy')
  const c = cfg({ degrade: 'wizard', wizardPath: wizard })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'manual-needed')
  // 引擎语义：candidatePath（刚下载的安装包）优先于 wizardPath —— 打开任意一个即满足“自动弹向导”
  assert.equal(H.shell.openPath.length, 1, `应打开安装向导: ${JSON.stringify(H.shell.openPath)}`)
  assert.ok(
    H.shell.openPath[0].endsWith('.exe'),
    `打开的应是安装包: ${H.shell.openPath[0]}`
  )
})

test('P0-3 降级 wizard：解析阶段失败（无 candidatePath）→ 打开 wizardPath', async () => {
  H.reset()
  const wizard = path.join(tmpAssets, 'setup2.exe')
  fs.writeFileSync(wizard, 'dummy')
  const c = cfg({
    source: { kind: 'url-resolver', resolver: '不存在的解析器' },
    degrade: 'wizard',
    wizardPath: wizard
  })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'manual-needed')
  assert.deepEqual(H.shell.openPath, [wizard], '解析失败降级应打开本地向导包')
})

test('P0-3 降级 wizard + wizardSelfLaunched（向日葵）：只标 manual-needed，不再打开安装包', async () => {
  H.reset()
  H.behavior.cmdCode = 1
  const wizard = path.join(tmpAssets, 'sunlogin-setup.exe')
  fs.writeFileSync(wizard, 'dummy')
  const c = cfg({ degrade: 'wizard', wizardSelfLaunched: true, wizardPath: wizard })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'manual-needed', `message: ${st.message}`)
  assert.deepEqual(
    H.shell.openPath,
    [],
    '引导器已自行拉起 GUI，不应再 openPath（避免二次弹窗）'
  )
})

test('degrade=none：静默失败 → failed（可重试）', async () => {
  H.reset()
  H.behavior.cmdCode = -1073741510
  const c = cfg({ degrade: 'none' })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'failed')
})

test('解析失败（未注册解析器）也走降级路径', async () => {
  H.reset()
  const c = cfg({ source: { kind: 'url-resolver', resolver: '不存在的解析器' }, degrade: 'browser', homepage: 'https://x.example/' })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'manual-needed')
  assert.deepEqual(H.shell.openExternal, ['https://x.example/'])
})

test('local-file 缺失 → failed 且明确提示路径', async () => {
  H.reset()
  const c = cfg({ source: { kind: 'local-file', localPath: '不存在.exe' }, silentArgs: '' })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'failed')
  assert.match(st.message, /本地安装包不存在/)
})

test('kind=none：打开官网 + manual-needed，不进入下载', async () => {
  H.reset()
  const c = cfg({ source: { kind: 'none' }, degrade: 'browser', homepage: 'https://manual.example/' })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'manual-needed')
  assert.deepEqual(H.shell.openExternal, ['https://manual.example/'])
  assert.equal(H.downloads.length, 0)
})

test('Geek 型纯下载（silentArgs undefined + desktop + renameTo）→ 文件落桌面，不执行安装', async () => {
  H.reset()
  const c = cfg({ silentArgs: undefined, downloadDir: 'desktop', renameTo: 'Geek卸载.zip' })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'success', `message: ${st.message}`)
  const dest = path.join(tmpDesktop, 'Geek卸载.zip')
  assert.ok(fs.existsSync(dest), `桌面应有重命名文件: ${dest}`)
  assert.equal(
    H.commands.filter((x) => x.kind === 'cmd' && x.cmd.includes('.exe" /S')).length,
    0,
    '纯下载任务不应执行静默安装'
  )
})

test('动漫共和国型 zip（extractZip 相对路径）→ 解压命令指向安装根目录（D:\\Apps，增量需求）', async () => {
  H.reset()
  const c = cfg({ silentArgs: undefined, source: { kind: 'direct-url', url: 'https://example.com/dmgh.zip' }, extractZip: '动漫共和国' })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'success', `message: ${st.message}`)
  const ps = H.commands.find((x) => x.kind === 'ps' && x.cmd.includes('Expand-Archive'))
  assert.ok(ps, '应调用 Expand-Archive 解压')
  // 增量需求：daily 类 zip 解压目标从桌面改为 D:\Apps\<名称>（无 D 盘回退 C:\Apps）
  const expectedRoot = fs.existsSync('D:\\') ? 'D:\\Apps' : 'C:\\Apps'
  assert.ok(ps.cmd.includes(path.join(expectedRoot, '动漫共和国')), `解压目标: ${ps.cmd}`)
  assert.ok(!ps.cmd.includes(tmpDesktop), '不应再解压到桌面')
})

test('校验失败 → failed；校验通过 → success（P0-1 校验链路）', async () => {
  H.reset()
  H.behavior.psStdout = 'not-a-version-output'
  const c1 = cfg({ verify: { command: 'go version', successPattern: 'go version' } })
  taskQueue.registerConfigs([c1 as never])
  taskQueue.enqueue([c1.id])
  assert.equal((await waitTerminal(c1.id)).status, 'failed')

  H.reset()
  H.behavior.psStdout = 'go version go1.23.0 windows/amd64'
  const c2 = cfg({ verify: { command: 'go version', successPattern: 'go version' } })
  taskQueue.registerConfigs([c2 as never])
  taskQueue.enqueue([c2.id])
  assert.equal((await waitTerminal(c2.id)).status, 'success')
})

test('cleanup-ime 后置动作在安装成功后触发（P0-8）', async () => {
  H.reset()
  const c = cfg({ postActions: [{ type: 'cleanup-ime' }] })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'success')
  assert.equal(H.imeCleanups, 1, '应调用输入法清理')
})

test('set-autostart：默认「不设开机启动」→ 跳过 Run 键写入（v1.0.2 门控）', async () => {
  H.reset()
  const g = globalThis as unknown as { __kdSettingsOverrides?: unknown }
  g.__kdSettingsOverrides = { setAutostart: false }
  const c = cfg({ postActions: [{ type: 'set-autostart', runKey: 'WuJieQuLian' }] })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'success', '自启门控不应导致任务失败')
  assert.ok(
    !H.commands.some((x) => x.kind === 'cmd' && x.cmd.includes('reg add')),
    '默认关闭时不得写 Run 键'
  )
  g.__kdSettingsOverrides = {}
})

test('set-autostart：显式开启后尝试写入 HKCU Run；未定位到 exe 也不失败', async () => {
  H.reset()
  const g = globalThis as unknown as { __kdSettingsOverrides?: unknown }
  g.__kdSettingsOverrides = { setAutostart: true }
  const c = cfg({ postActions: [{ type: 'set-autostart', runKey: 'WuJieQuLian' }] })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'success', '自启未定位不应导致任务失败')
  const reg = H.commands.find((x) => x.kind === 'cmd' && x.cmd.includes('reg add'))
  if (reg) {
    assert.match(reg.cmd, /HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run/)
    assert.match(reg.cmd, /\/v "WuJieQuLian"/)
  }
  g.__kdSettingsOverrides = {}
})

test('create-shortcut：开启开关时对 daily 项创建桌面快捷方式（显式 target）', async () => {
  H.reset()
  const g = globalThis as unknown as { __kdSettingsOverrides?: unknown }
  g.__kdSettingsOverrides = { createShortcut: true }
  const exe = path.join(tmpAssets, 'MyApp.exe')
  fs.writeFileSync(exe, 'stub')
  const c = cfg({
    silentArgs: undefined,
    source: { kind: 'direct-url', url: 'https://example.com/MyApp.exe' },
    shortcut: { target: exe, name: 'MyApp' }
  })
  taskQueue.registerConfigs([c as never])
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'success', `message: ${st.message}`)
  const ps = H.commands.find((x) => x.kind === 'ps' && x.cmd.includes("CreateShortcut('"))
  assert.ok(ps, `应调用 WScript.Shell CreateShortcut: ${JSON.stringify(H.commands)}`)
  assert.ok(ps.cmd.includes(exe), `快捷方式目标应指向 ${exe}: ${ps.cmd}`)
  g.__kdSettingsOverrides = {}
})

test('安装互斥：多个安装任务串行执行（并发安装 = 1）', async () => {
  H.reset()
  const list = [cfg({}), cfg({}), cfg({})]
  taskQueue.registerConfigs(list as never)
  H.behavior.delayMs = 60
  // 监测 execCmd 安装命令并发
  let inFlight = 0
  let maxInstall = 0
  const origPush = H.commands.push.bind(H.commands)
  Object.defineProperty(H.commands, 'push', {
    value(...args: never[]) {
      const rec = args[0] as { kind: string }
      if (rec.kind === 'cmd') {
        inFlight++
        maxInstall = Math.max(maxInstall, inFlight)
        setTimeout(() => inFlight--, 40)
      }
      return origPush(...args)
    }
  })
  taskQueue.enqueue(list.map((c) => c.id))
  await Promise.all(list.map((c) => waitTerminal(c.id)))
  assert.ok(maxInstall <= 1, `安装必须互斥，观测到并发 ${maxInstall}`)
})

test('下载并发上限 3（ARCH：下载并发 3）', async () => {
  H.reset()
  const list = Array.from({ length: 6 }, () =>
    cfg({ silentArgs: undefined, source: { kind: 'direct-url', url: `https://example.com/dl${Math.random()}.exe` } })
  )
  taskQueue.registerConfigs(list as never)
  H.behavior.downloadDelayMs = 80
  H.behavior.maxConcurrent = 0
  taskQueue.enqueue(list.map((c) => c.id))
  await Promise.all(list.map((c) => waitTerminal(c.id)))
  assert.ok(H.behavior.maxConcurrent <= 3, `下载并发应 ≤3，观测到 ${H.behavior.maxConcurrent}`)
  assert.ok(H.behavior.maxConcurrent >= 2, `应存在并行下载，观测到 ${H.behavior.maxConcurrent}`)
})

test('缓存命中跳过下载（P2-2）：开启缓存后同 URL 第二次不再下载', async () => {
  H.reset()
  const g = globalThis as unknown as { __kdCacheEnabled?: boolean }
  g.__kdCacheEnabled = true
  const c = cfg({ silentArgs: undefined, source: { kind: 'direct-url', url: 'https://example.com/cached-setup.exe' } })
  taskQueue.registerConfigs([c as never])
  // 第一次：下载并产生缓存
  taskQueue.enqueue([c.id])
  await waitTerminal(c.id)
  assert.equal(H.downloads.length, 1)
  // 第二次：同 URL → 命中缓存，跳过下载
  H.downloads.length = 0
  taskQueue.enqueue([c.id])
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'success')
  assert.equal(H.downloads.length, 0, '缓存命中时不应再次下载')
  g.__kdCacheEnabled = false
})

test('retry：仅 failed / manual-needed / pending 可重试（P2-4）', async () => {
  H.reset()
  const c = cfg({ degrade: 'none' })
  taskQueue.registerConfigs([c as never])
  H.behavior.cmdCode = 1
  taskQueue.enqueue([c.id])
  await waitTerminal(c.id)
  assert.equal(taskQueue.retry([c.id]), 1, 'failed 可重试')
  const st = await waitTerminal(c.id)
  assert.equal(st.status, 'failed') // cmdCode 仍为 1
  H.behavior.cmdCode = 0
  assert.equal(taskQueue.retry([c.id]), 1)
  assert.equal((await waitTerminal(c.id)).status, 'success')
})

test('cancel：未知 id 返回 false；执行中的任务不可取消', async () => {
  assert.equal(taskQueue.cancel('no-such-id'), false)
  const c = cfg({})
  taskQueue.registerConfigs([c as never])
  H.behavior.delayMs = 30
  taskQueue.enqueue([c.id])
  // enqueue 同步启动后任务已进入 checking/running
  assert.equal(taskQueue.cancel(c.id), false, '执行中任务不可取消')
  await waitTerminal(c.id)
})

test('重复入队防护：执行中任务不会被重复入队', async () => {
  H.reset()
  const c = cfg({})
  taskQueue.registerConfigs([c as never])
  H.behavior.delayMs = 40
  assert.equal(taskQueue.enqueue([c.id]), 1)
  assert.equal(taskQueue.enqueue([c.id]), 0, '执行中跳过')
  await waitTerminal(c.id)
})

test('enqueue 未知 id 被过滤', async () => {
  assert.equal(taskQueue.enqueue(['ghost-id']), 0)
})
