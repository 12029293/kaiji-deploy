/**
 * 增量需求测试：FFmpeg 加入开发环境（C 盘）+ 非开发环境软件统一安装到 D 盘。
 * 覆盖：devEnv ffmpeg 配置、buildSilentCommand 三类安装器目录注入（NSIS /D=、Inno /DIR=、MSI INSTALLDIR）、
 * zip 解压目标分流（daily → D:\Apps）、add-path 后置动作（含 zip 内层版本目录解析回退）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { bundleModule, makeTmpDir, hooks, ASSET_ROOT } from './helpers/bundle.mts'

const tmpOut = makeTmpDir('kd-dir-')
const H = hooks()
H.reset()
process.env.KD_TMP_USERDATA = tmpOut
// 本文件聚焦“安装目录注入”逻辑，关闭快捷方式自动创建以避免扫描真实 Program Files
;(globalThis as unknown as { __kdSettingsOverrides?: unknown }).__kdSettingsOverrides = {
  createShortcut: false
}

const fixture = {
  cache: path.join(tmpOut, 'cache'),
  desktop: path.join(tmpOut, 'desktop'),
  assets: ASSET_ROOT,
  edgeBookmarks: path.join(tmpOut, 'Bookmarks'),
  edgePrefs: path.join(tmpOut, 'Preferences'),
  edgeHtml: '',
  installRoot: path.join(tmpOut, 'D-Apps') // 模拟 D:\Apps（测试不写真实 D 盘）
}
fs.mkdirSync(fixture.cache, { recursive: true })
fs.mkdirSync(fixture.desktop, { recursive: true })

/* ---------- 配置静态断言 ---------- */

const cfgMod = await bundleModule(path.join(process.cwd(), 'src/main/config/devEnv.config.ts'), {
  tmpOut,
  name: 'devEnvConfig',
  pathsFixture: fixture
})
const { devEnvConfigs } = await import(cfgMod)

test('FFmpeg 已加入开发环境（C 盘策略）：zip 免安装 + add-path + 校验命令', () => {
  const ff = devEnvConfigs.find((c) => c.id === 'ffmpeg')
  assert.ok(ff, 'devEnvConfigs 应含 ffmpeg')
  assert.equal(ff.name, 'FFmpeg')
  assert.equal(ff.category, 'devenv')
  assert.equal(ff.source.kind, 'github-release')
  assert.equal(ff.source.repo, 'GyanD/codexffmpeg')
  assert.match(ff.source.assetPattern ?? '', /essentials_build/)
  assert.equal(ff.extractZip, 'C:\\ffmpeg', 'FFmpeg 解压到 C 盘')
  assert.equal(ff.silentArgs, undefined, 'zip 免安装，无静默安装')
  assert.ok(
    (ff.postActions ?? []).some((a) => a.type === 'add-path'),
    '应有 add-path 后置动作'
  )
  assert.match(ff.verify?.command ?? '', /ffmpeg\.exe/, '校验命令应调用 ffmpeg.exe')
  assert.equal(ff.verify?.successPattern, 'ffmpeg version')
})

/* ---------- 引擎行为断言（buildSilentCommand + finishInstall） ---------- */

const installerMod = await bundleModule(
  path.join(process.cwd(), 'src/main/engine/installer.ts'),
  { tmpOut, name: 'installer', pathsFixture: fixture }
)
const installer = await import(installerMod)

function fakeCfg(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 't-app',
    name: '测试应用',
    category: 'daily',
    source: { kind: 'local-file', localPath: 'x.exe' },
    silentArgs: '/S',
    degrade: 'none',
    ...overrides
  }
}

test('NSIS(/S) 注入 /D=<安装根><id>，且 /D 位于命令末尾', () => {
  const cmd = installer.buildSilentCommand(
    fakeCfg({}) as never,
    'C:\\cache\\app-setup.exe'
  )
  const expected = path.join(fixture.installRoot, 't-app')
  assert.ok(cmd.endsWith(`/D=${expected}`), `命令应以 /D= 结尾: ${cmd}`)
  assert.ok(cmd.includes('" /S /D='), `命令: ${cmd}`)
})

test('Inno(/VERYSILENT) 注入 /DIR="<安装根><id>"', () => {
  const cmd = installer.buildSilentCommand(
    fakeCfg({ silentArgs: '/VERYSILENT /NORESTART' }) as never,
    'C:\\cache\\app-setup.exe'
  )
  const expected = path.join(fixture.installRoot, 't-app')
  assert.ok(cmd.includes(`/DIR="${expected}"`), `命令: ${cmd}`)
  assert.ok(!cmd.includes('/D='), `Inno 不应使用 NSIS /D=: ${cmd}`)
})

test('MSI 注入 INSTALLDIR=', () => {
  const cmd = installer.buildSilentCommand(
    fakeCfg({ silentArgs: '/qn' }) as never,
    'C:\\cache\\app.msi'
  )
  const expected = path.join(fixture.installRoot, 't-app')
  assert.ok(cmd.startsWith('msiexec /i'), `命令: ${cmd}`)
  assert.ok(cmd.includes(`INSTALLDIR="${expected}"`), `命令: ${cmd}`)
})

test('开发环境（devenv）不注入目录参数，保持 C 盘默认', () => {
  const cmd = installer.buildSilentCommand(
    fakeCfg({ category: 'devenv', id: 'go' }) as never,
    'C:\\cache\\go.msi'
  )
  assert.ok(!cmd.includes('INSTALLDIR'), `devenv 不应注入 INSTALLDIR: ${cmd}`)
  const cmd2 = installer.buildSilentCommand(
    fakeCfg({ category: 'devenv', id: 'git', silentArgs: '/VERYSILENT /NORESTART' }) as never,
    'C:\\cache\\git.exe'
  )
  assert.ok(!cmd2.includes('/DIR='), `devenv 不应注入 /DIR=: ${cmd2}`)
  assert.equal(installer.getInstallDirFor(fakeCfg({ category: 'devenv' }) as never), null)
})

test('finishInstall：daily 的 zip（无 extractZip 绝对路径）解压到 <安装根><extractZip>', async () => {
  H.reset()
  const zipPath = path.join(fixture.cache, 'dmgh-win.zip')
  fs.writeFileSync(zipPath, 'stub-zip')
  const c = fakeCfg({
    id: 'dmgh',
    name: '动漫共和国',
    silentArgs: undefined,
    extractZip: '动漫共和国'
  }) as never
  const outcome = await installer.finishInstall(c, zipPath, () => {})
  assert.equal(outcome.status, 'success')
  const expand = H.commands.find(
    (x) => x.kind === 'ps' && String(x.cmd).includes('Expand-Archive')
  )
  assert.ok(expand, `应执行 Expand-Archive: ${JSON.stringify(H.commands)}`)
  const expected = path.join(fixture.installRoot, '动漫共和国')
  assert.ok(
    String(expand.cmd).includes(expected.replace(/\\/g, '')) ||
      String(expand.cmd).includes(expected),
    `解压目标应为 ${expected}: ${expand.cmd}`
  )
})

test('finishInstall：add-path 在 bin 直连不存在时回退解析父目录下唯一 <子目录>/bin', async () => {
  H.reset()
  // 构造 <tmp>\ffmpeg\ffmpeg-8.0-essentials_build\bin\ffmpeg.exe（模拟 zip 解压结果）
  const ffmpegRoot = path.join(tmpOut, 'ffmpeg')
  const binDir = path.join(ffmpegRoot, 'ffmpeg-8.0-essentials_build', 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(path.join(binDir, 'ffmpeg.exe'), 'stub')
  const zipPath = path.join(fixture.cache, 'ffmpeg.zip')
  fs.writeFileSync(zipPath, 'stub-zip')
  const c = fakeCfg({
    id: 'ffmpeg',
    name: 'FFmpeg',
    category: 'devenv',
    silentArgs: undefined,
    extractZip: ffmpegRoot,
    postActions: [{ type: 'add-path', dir: path.join(ffmpegRoot, 'bin') }]
  }) as never
  const outcome = await installer.finishInstall(c, zipPath, () => {})
  assert.equal(outcome.status, 'success')
  const pathCmd = H.commands.find((x) => x.kind === 'ps' && String(x.cmd).includes("SetEnvironmentVariable('Path'"))
  assert.ok(pathCmd, `应执行 PATH 追加: ${JSON.stringify(H.commands)}`)
  assert.ok(
    String(pathCmd.cmd).includes(binDir),
    `PATH 命令应包含解析后的 bin 目录 ${binDir}: ${pathCmd.cmd}`
  )
})

test('finishInstall：add-path 目录与父目录回退均不存在 → 跳过并保持 success（不中断主流程）', async () => {
  H.reset()
  const zipPath = path.join(fixture.cache, 'tool.zip')
  fs.writeFileSync(zipPath, 'stub-zip')
  const c = fakeCfg({
    silentArgs: undefined,
    extractZip: path.join(tmpOut, 'tool-x'),
    postActions: [{ type: 'add-path', dir: path.join(tmpOut, 'no-such-root', 'bin') }]
  }) as never
  const outcome = await installer.finishInstall(c, zipPath, () => {})
  assert.equal(outcome.status, 'success')
  assert.ok(
    !H.commands.some((x) => x.kind === 'ps' && String(x.cmd).includes('SetEnvironmentVariable')),
    '目录不存在时不应写 PATH'
  )
})
