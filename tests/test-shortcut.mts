/**
 * 桌面快捷方式服务测试（v1.0.2）：
 *  - pickMainExe 纯函数打分（uninstall/setup 干扰项、深层 exe、空候选）
 *  - createDesktopShortcut：定位安装目录主程序 → 调用 WScript.Shell 建 lnk
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { bundleModule, makeTmpDir, hooks } from './helpers/bundle.mts'

const tmpOut = makeTmpDir('kd-sc-')
const H = hooks()
H.reset()
process.env.KD_TMP_USERDATA = tmpOut

const installRoot = path.join(tmpOut, 'D-Apps')
const desktop = path.join(tmpOut, 'desktop')
fs.mkdirSync(desktop, { recursive: true })
fs.mkdirSync(installRoot, { recursive: true })

const fixture = {
  cache: path.join(tmpOut, 'cache'),
  desktop,
  assets: path.join(tmpOut, 'assets'),
  edgeBookmarks: path.join(tmpOut, 'Bookmarks'),
  edgePrefs: path.join(tmpOut, 'Preferences'),
  edgeHtml: '',
  installRoot
}
fs.mkdirSync(fixture.cache, { recursive: true })
fs.mkdirSync(fixture.assets, { recursive: true })

const mod = await bundleModule(
  path.join(process.cwd(), 'src/main/services/shortcutService.ts'),
  { tmpOut, name: 'shortcutService', pathsFixture: fixture }
)
const {
  pickMainExe,
  collectExeCandidates,
  detectMainExe,
  resolveLaunchTarget,
  createDesktopShortcut
} = await import(mod)

/* ---------------- pickMainExe 纯函数 ---------------- */

test('pickMainExe：命中 id 的主程序胜出，uninstall / vcredist 被扣分', () => {
  const picked = pickMainExe(
    ['C:\\X\\uninstall.exe', 'C:\\X\\ToDesk.exe', 'C:\\X\\vcredist_x64.exe'],
    { id: 'todesk', name: 'ToDesk' }
  )
  assert.equal(picked, 'C:\\X\\ToDesk.exe')
})

test('pickMainExe：层级越浅越优先（同名深层 vs 浅层）', () => {
  const picked = pickMainExe(['C:\\a\\b\\c\\App.exe', 'C:\\a\\App.exe'], {
    id: 'app',
    name: 'App'
  })
  assert.equal(picked, 'C:\\a\\App.exe')
})

test('pickMainExe：setup/install 干扰项被硬过滤，Foo.exe 胜出', () => {
  const picked = pickMainExe(['C:\\Foo\\setup.exe', 'C:\\Foo\\Foo.exe'], {
    id: 'foo',
    name: 'Foo'
  })
  assert.equal(picked, 'C:\\Foo\\Foo.exe')
})

test('pickMainExe：仅剩安装器/卸载器候选 → null（硬过滤，宁可不建也不指错）', () => {
  assert.equal(
    pickMainExe(['C:\\Foo\\动漫共和国概念版-1.4.4-flutter-setup-x64.exe'], {
      id: 'dmgh',
      name: '动漫共和国'
    }),
    null
  )
  assert.equal(pickMainExe(['C:\\Foo\\unins000.exe'], { id: 'foo', name: 'Foo' }), null)
  assert.equal(
    pickMainExe(['C:\\Foo\\setup.exe', 'C:\\Foo\\unins000.exe'], { id: 'foo', name: 'Foo' }),
    null
  )
})

test('pickMainExe：空候选 → null', () => {
  assert.equal(pickMainExe([], { id: 'x', name: 'X' }), null)
})

test('resolveLaunchTarget：脚本目标经 powershell -File 启动；exe 目标保持原样', () => {
  const script = resolveLaunchTarget(
    'D:\\Apps\\影策\\open-ai-canvas-main\\scripts\\start-local.ps1',
    {
      id: 'yingce',
      name: '影策',
      category: 'proxy',
      source: { kind: 'direct-url', url: 'x' },
      degrade: 'none'
    } as never
  )
  assert.match(script.target, /powershell\.exe$/i)
  assert.ok(script.args.includes('-ExecutionPolicy Bypass -File'), script.args)
  assert.ok(script.args.includes('start-local.ps1'), script.args)
  assert.equal(script.workDir, path.dirname('D:\\Apps\\影策\\open-ai-canvas-main\\scripts\\start-local.ps1'))

  const exe = resolveLaunchTarget('C:\\X\\MyApp.exe', {
    id: 'a',
    name: 'A',
    category: 'daily',
    source: { kind: 'direct-url', url: 'x' },
    degrade: 'none',
    shortcut: { args: '--foo' }
  } as never)
  assert.equal(exe.target, 'C:\\X\\MyApp.exe')
  assert.equal(exe.args, '--foo')
})

/* ---------------- collectExeCandidates ---------------- */

test('collectExeCandidates：递归收集 exe 且跳过 node_modules/resources', () => {
  const root = path.join(tmpOut, 'tree')
  fs.mkdirSync(path.join(root, 'sub', 'resources'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.writeFileSync(path.join(root, 'Main.exe'), 'x')
  fs.writeFileSync(path.join(root, 'sub', 'Inner.exe'), 'x')
  fs.writeFileSync(path.join(root, 'sub', 'resources', 'skip.exe'), 'x')
  fs.writeFileSync(path.join(root, 'node_modules', 'skip2.exe'), 'x')
  const found = collectExeCandidates([root], 3)
  assert.ok(found.some((p) => p.endsWith('Main.exe')))
  assert.ok(found.some((p) => p.endsWith('Inner.exe')))
  assert.ok(!found.some((p) => p.endsWith('skip.exe')))
  assert.ok(!found.some((p) => p.endsWith('skip2.exe')))
})

/* ---------------- detect + create ---------------- */

test('detectMainExe：在 D:\\Apps\\<id> 定位主程序（排除卸载器）', () => {
  const appDir = path.join(installRoot, 'myapp')
  fs.mkdirSync(appDir, { recursive: true })
  fs.writeFileSync(path.join(appDir, 'MyApp.exe'), 'stub')
  fs.writeFileSync(path.join(appDir, 'unins000.exe'), 'stub')
  const det = detectMainExe({
    id: 'myapp',
    name: 'MyApp',
    category: 'daily',
    source: { kind: 'direct-url', url: 'x' },
    degrade: 'none'
  } as never)
  assert.ok(det)
  assert.equal(path.basename(det.exe), 'MyApp.exe')
})

test('detectMainExe：显式 target 未命中 → 在解压/安装目录下按 basename 递归兜底', () => {
  const yd = path.join(installRoot, 'yingce')
  const nested = path.join(yd, 'open-ai-canvas-main', 'scripts')
  fs.mkdirSync(nested, { recursive: true })
  fs.writeFileSync(path.join(nested, 'start-local.ps1'), '# stub')
  const det = detectMainExe({
    id: 'yingce',
    name: '影策',
    category: 'proxy',
    source: { kind: 'direct-url', url: 'x' },
    extractZip: '影策',
    shortcut: { target: 'scripts\\start-local.ps1' },
    degrade: 'none'
  } as never)
  assert.ok(det, '应兜底定位到 start-local.ps1')
  assert.ok(det.exe.endsWith('start-local.ps1'), det.exe)
})

test('createDesktopShortcut：调用 WScript.Shell 创建 .lnk，目标指向主程序', async () => {
  H.reset()
  const res = await createDesktopShortcut({
    id: 'myapp',
    name: 'MyApp',
    category: 'daily',
    source: { kind: 'direct-url', url: 'x' },
    degrade: 'none'
  } as never)
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.ok(res.target && res.target.endsWith('MyApp.exe'))
  // 写 .lnk 的命令形如 ...CreateShortcut('<path>')；枚举命令是 CreateShortcut($_.FullName)，据此区分
  const ps = H.commands.find((x) => x.kind === 'ps' && x.cmd.includes("CreateShortcut('"))
  assert.ok(ps, `应调用 CreateShortcut: ${JSON.stringify(H.commands)}`)
  assert.ok(String(ps.cmd).includes('MyApp.exe'), `lnk 目标应为主程序: ${ps.cmd}`)
  assert.ok(String(ps.cmd).includes(path.join(desktop, 'MyApp.lnk')), `lnk 应落在桌面: ${ps.cmd}`)
})

test('createDesktopShortcut：桌面已存在异名等价 .lnk（本轮安装器自建）→ 删除重复并创建我方快捷方式', async () => {
  H.reset()
  const appDir = path.join(installRoot, 'dedup')
  fs.mkdirSync(appDir, { recursive: true })
  const target = path.join(appDir, 'Dedup.exe')
  fs.writeFileSync(target, 'stub')
  const foreignLnk = path.join(desktop, 'Dedup概念版.lnk')
  fs.writeFileSync(foreignLnk, 'stub-lnk')
  // 模拟：安装器自建了一条指向同一 exe 的异名快捷方式（本轮新建）
  H.behavior.psStdout = `${foreignLnk}\t${target}\r\n`
  const res = await createDesktopShortcut(
    {
      id: 'dedup',
      name: 'Dedup',
      category: 'daily',
      source: { kind: 'direct-url', url: 'x' },
      degrade: 'none'
    } as never,
    Date.now() - 5000
  )
  H.behavior.psStdout = ''
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.ok(!fs.existsSync(foreignLnk), '本轮自建的异名等价 .lnk 应被删除')
  const write = H.commands.find((x) => x.kind === 'ps' && x.cmd.includes("CreateShortcut('"))
  assert.ok(write, `应创建我方快捷方式: ${JSON.stringify(H.commands)}`)
  assert.ok(String(write.cmd).includes(path.join(desktop, 'Dedup.lnk')), `应落在桌面 Dedup.lnk: ${write.cmd}`)
})

test('createDesktopShortcut：桌面已存在异名等价 .lnk（早于本轮）→ 保守跳过且不删除', async () => {
  H.reset()
  const appDir = path.join(installRoot, 'oldapp')
  fs.mkdirSync(appDir, { recursive: true })
  const target = path.join(appDir, 'OldApp.exe')
  fs.writeFileSync(target, 'stub')
  const oldLnk = path.join(desktop, 'OldApp历史.lnk')
  fs.writeFileSync(oldLnk, 'stub-lnk')
  // 把 mtime 拨到 1 小时前 → 早于本轮安装开始时间
  const past = new Date(Date.now() - 3600_000)
  fs.utimesSync(oldLnk, past, past)
  H.behavior.psStdout = `${oldLnk}\t${target}\r\n`
  const res = await createDesktopShortcut(
    {
      id: 'oldapp',
      name: 'OldApp',
      category: 'daily',
      source: { kind: 'direct-url', url: 'x' },
      degrade: 'none'
    } as never,
    Date.now()
  )
  H.behavior.psStdout = ''
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.match(res.message, /^已存在等价快捷方式，跳过创建（OldApp历史\.lnk）$/)
  assert.ok(fs.existsSync(oldLnk), '早于本轮的等价 .lnk 不应被删除')
  assert.ok(
    !H.commands.some((x) => x.kind === 'ps' && x.cmd.includes("CreateShortcut('")),
    '不应创建我方快捷方式（避免重复）'
  )
})

test('createDesktopShortcut：桌面预置同名等价 .lnk 且 mtime 早于本轮 → 跳过创建且不覆盖（QA 3b 回归）', async () => {
  H.reset()
  const appDir = path.join(installRoot, 'samename')
  fs.mkdirSync(appDir, { recursive: true })
  const target = path.join(appDir, 'Dmgh.exe')
  fs.writeFileSync(target, 'stub')
  // 预置一个与我们规范名相同的 .lnk（文件名相同但 mtime 远早于本轮，非本轮自建）
  const sameLnk = path.join(desktop, 'Dmgh.lnk')
  fs.writeFileSync(sameLnk, 'stub-lnk')
  const past = new Date(2020, 0, 1)
  fs.utimesSync(sameLnk, past, past)
  const mtimeBefore = fs.statSync(sameLnk).mtimeMs
  H.behavior.psStdout = `${sameLnk}\t${target}\r\n`
  const res = await createDesktopShortcut(
    {
      id: 'samename',
      name: 'Dmgh',
      category: 'daily',
      source: { kind: 'direct-url', url: 'x' },
      degrade: 'none'
    } as never,
    Date.now()
  )
  H.behavior.psStdout = ''
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.match(res.message, /^已存在等价快捷方式，跳过创建（Dmgh\.lnk）$/)
  assert.ok(fs.existsSync(sameLnk), '同名等价 .lnk 不应被删除')
  const mtimeAfter = fs.statSync(sameLnk).mtimeMs
  assert.equal(mtimeAfter, mtimeBefore, '同名等价 .lnk 不应被覆盖（mtime 不变）')
  assert.ok(
    !H.commands.some((x) => x.kind === 'ps' && x.cmd.includes("CreateShortcut('")),
    '不应调用 CreateShortcut 覆盖同名旧 .lnk'
  )
})

test('createDesktopShortcut：同名旧等价项 + 本轮自建异名项并存 → 删异名、留旧同名、不写入，最终 1 条（3b 二刀回归）', async () => {
  H.reset()
  const appDir = path.join(installRoot, 'coexist')
  fs.mkdirSync(appDir, { recursive: true })
  const target = path.join(appDir, 'Coexist.exe')
  fs.writeFileSync(target, 'stub')
  // 旧同名等价项（QA 3b：预置 2020 诱饵）
  const oldSameLnk = path.join(desktop, 'Coexist.lnk')
  fs.writeFileSync(oldSameLnk, 'stub-lnk')
  const past = new Date(2020, 0, 1)
  fs.utimesSync(oldSameLnk, past, past)
  const oldMtimeBefore = fs.statSync(oldSameLnk).mtimeMs
  // 本轮内层安装器自建的异名等价项（fresh）
  const freshForeignLnk = path.join(desktop, 'Coexist概念版.lnk')
  fs.writeFileSync(freshForeignLnk, 'stub-lnk')
  H.behavior.psStdout = `${oldSameLnk}\t${target}\r\n${freshForeignLnk}\t${target}\r\n`
  const res = await createDesktopShortcut(
    {
      id: 'coexist',
      name: 'Coexist',
      category: 'daily',
      source: { kind: 'direct-url', url: 'x' },
      degrade: 'none'
    } as never,
    Date.now() - 5000
  )
  H.behavior.psStdout = ''
  assert.equal(res.ok, true, JSON.stringify(res))
  assert.ok(!fs.existsSync(freshForeignLnk), '本轮自建异名等价项应被清理')
  assert.ok(fs.existsSync(oldSameLnk), '旧同名等价项应保留')
  assert.equal(fs.statSync(oldSameLnk).mtimeMs, oldMtimeBefore, '旧同名 .lnk 不应被覆盖（mtime 不变）')
  assert.match(res.message, /^已存在等价快捷方式，跳过创建（Coexist\.lnk）$/)
  assert.ok(
    !H.commands.some((x) => x.kind === 'ps' && x.cmd.includes("CreateShortcut('")),
    '跳过写入：不应调用 CreateShortcut'
  )
  // 最终桌面恰好 1 条等价项
  const left = [oldSameLnk, freshForeignLnk].filter((p) => fs.existsSync(p))
  assert.equal(left.length, 1, `桌面应恰好 1 条，实际: ${left.join('、')}`)
})

test('createDesktopShortcut：未定位到主程序 → ok:false 且不抛（不阻断任务）', async () => {
  H.reset()
  const res = await createDesktopShortcut({
    id: 'ghost-xyz',
    name: 'Ghost',
    category: 'daily',
    source: { kind: 'direct-url', url: 'x' },
    degrade: 'none'
  } as never)
  assert.equal(res.ok, false)
  assert.ok(!H.commands.some((x) => x.kind === 'ps' && x.cmd.includes('CreateShortcut')))
})
