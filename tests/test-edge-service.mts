/**
 * Edge 定制服务测试：msedge 进程检测逻辑、关闭 Edge、收藏夹写入（真实 HTML → tmp 路径）、
 * Preferences 深色主题 user_color_scheme=2 与下载目录=桌面、写入前备份（ARCH 共享知识 #8）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bundleModule, makeTmpDir, hooks } from './helpers/bundle.mts'

const tmpOut = makeTmpDir('kd-edge-')
const tmpDesktop = makeTmpDir('kd-desktop-')
const EDGE_HTML = 'C:\\Users\\Administrator\\Desktop\\Edge收藏夹.html'

const H = hooks()
H.reset()

const prefsPath = path.join(tmpOut, 'Preferences')
const bookmarksPath = path.join(tmpOut, 'Bookmarks')

const mod = await bundleModule(path.join(process.cwd(), 'src/main/services/edgeService.ts'), {
  tmpOut,
  name: 'edgeService',
  pathsFixture: {
    cache: tmpOut,
    desktop: tmpDesktop,
    assets: tmpOut,
    edgeBookmarks: bookmarksPath,
    edgePrefs: prefsPath,
    edgeHtml: EDGE_HTML
  }
})
const { edgeService } = await import(mod)

test('isEdgeRunning：tasklist | find 命中 → true；未命中(退出码1) → false', async () => {
  H.behavior.cmdCode = 0
  assert.equal(await edgeService.isEdgeRunning(), true)
  const cmd = H.commands[0].cmd
  assert.ok(cmd.includes('tasklist'), `应使用 tasklist 检测，实际: ${cmd}`)
  assert.ok(cmd.includes('msedge.exe'), '应针对 msedge.exe 进程检测')
  H.behavior.cmdCode = 1
  assert.equal(await edgeService.isEdgeRunning(), false)
  H.behavior.cmdCode = 0
})

test('customize：Edge 运行中时拒绝执行（P0-9 验收“请先关闭 Edge”）', async () => {
  H.behavior.cmdCode = 0 // 模拟 Edge 运行中
  const res = await edgeService.customize({ favorites: true, dark: true, downloadDir: true })
  assert.equal(res.ok, false)
  assert.match(res.details[0], /正在运行|关闭 Edge/)
  assert.equal(fs.existsSync(bookmarksPath), false, '运行中不得写入 Bookmarks')
  assert.equal(fs.existsSync(prefsPath), false, '运行中不得写入 Preferences')
})

test('closeEdge：taskkill /f /im msedge.exe 后检测返回 true', async () => {
  H.commands.length = 0
  H.behavior.cmdCode = 1 // 关闭后无进程
  const ok = await edgeService.closeEdge()
  assert.equal(ok, true)
  const kill = H.commands.find((c) => c.cmd.includes('taskkill'))
  assert.ok(kill, '应调用 taskkill')
  assert.ok(kill.cmd.includes('/f /im msedge.exe'), `关闭命令: ${kill.cmd}`)
})

test('customize(favorites)：解析真实收藏夹并写入 Chromium Bookmarks JSON', async () => {
  H.behavior.cmdCode = 1 // Edge 未运行
  H.commands.length = 0
  const res = await edgeService.customize({ favorites: true, dark: false, downloadDir: false })
  assert.equal(res.ok, true, res.details.join(';'))
  assert.ok(fs.existsSync(bookmarksPath), 'Bookmarks 文件应写入')
  const json = JSON.parse(fs.readFileSync(bookmarksPath, 'utf-8'))
  assert.equal(json.version, 1)
  assert.ok(json.roots.bookmark_bar.children.length >= 15, '收藏夹栏应有大量书签')
  assert.ok(json.roots.other.children.length >= 3, '顶层散签应进 other')
  const baidu = json.roots.bookmark_bar.children.find((c) => c.name === '百度一下')
  assert.equal(baidu.url, 'https://bd.001060.com/')
  // 结果详情包含统计
  assert.match(res.details[0], /收藏夹导入完成/)
})

test('customize(dark+downloadDir)：user_color_scheme=2 且 default_directory=桌面，写前备份', async () => {
  // 预置已有 Preferences（含需保留的其他键）
  fs.writeFileSync(
    prefsPath,
    JSON.stringify({
      browser: { show_home_button: true, theme: { user_color_scheme: 0 } },
      download: { prompt_for_download: false },
      session: { restore_on_startup: 4 }
    }),
    'utf-8'
  )
  const res = await edgeService.customize({ favorites: false, dark: true, downloadDir: true })
  assert.equal(res.ok, true, res.details.join(';'))
  const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8'))
  assert.equal(prefs.browser.theme.user_color_scheme, 2, '深色主题应写 browser.theme.user_color_scheme=2')
  assert.equal(prefs.browser.show_home_button, true, '原有键必须保留')
  assert.equal(prefs.download.default_directory, tmpDesktop, '下载目录应指向桌面')
  assert.equal(prefs.download.prompt_for_download, false, '原有 download 键必须保留')
  assert.equal(prefs.session.restore_on_startup, 4, '无关键不得被破坏')
  // 备份
  assert.ok(fs.existsSync(prefsPath + '.kd-bak'), '写 Preferences 前应备份 *.kd-bak')
  const bak = JSON.parse(fs.readFileSync(prefsPath + '.kd-bak', 'utf-8'))
  assert.equal(bak.browser.theme.user_color_scheme, 0, '备份应为写入前内容')
  assert.match(res.details.join(';'), /深色/)
  assert.match(res.details.join(';'), /桌面/)
})

test('customize(favorites)：源 HTML 缺失时逐项容错并报错详情', async () => {
  // 用不存在的 HTML 路径重新打包一个小变体来测，不污染其他用例：
  // 直接改用 edgeHtml 指向不存在文件 → 需要新 bundle
  const tmp2 = makeTmpDir('kd-edge2-')
  const mod2 = await bundleModule(path.join(process.cwd(), 'src/main/services/edgeService.ts'), {
    tmpOut: tmp2,
    name: 'edgeServiceMissing',
    pathsFixture: {
      cache: tmp2,
      desktop: tmpDesktop,
      assets: tmp2,
      edgeBookmarks: path.join(tmp2, 'Bookmarks'),
      edgePrefs: path.join(tmp2, 'Preferences'),
      edgeHtml: path.join(tmp2, '不存在.html')
    }
  })
  const { edgeService: svc2 } = await import(mod2)
  H.behavior.cmdCode = 1
  const res = await svc2.customize({ favorites: true, dark: true, downloadDir: false })
  assert.equal(res.ok, false)
  assert.match(res.details.join(';'), /未找到收藏夹源文件/)
  // favorites 失败但 dark 仍应成功写入
  const prefs = JSON.parse(fs.readFileSync(path.join(tmp2, 'Preferences'), 'utf-8'))
  assert.equal(prefs.browser.theme.user_color_scheme, 2, '收藏夹失败不应阻塞深色写入')
})

test('Bookmarks.bak 一并移除（避免 Edge 启动恢复旧数据）', async () => {
  fs.writeFileSync(bookmarksPath + '.bak', '{"stale":true}', 'utf-8')
  const res = await edgeService.customize({ favorites: true, dark: false, downloadDir: false })
  assert.equal(res.ok, true)
  assert.equal(fs.existsSync(bookmarksPath + '.bak'), false, 'Bookmarks.bak 应被移除')
})
