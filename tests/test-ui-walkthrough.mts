/**
 * UI 代码走查（静态验证，无需启动 Electron 窗口）：
 * 7 模块路由完整性、深色主题落实、批量安装交互、首次 Edge 引导弹窗、危险操作二次确认。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { SRC } from './helpers/bundle.mts'

const R = path.join(SRC, 'renderer/src')
const read = (p: string): string => fs.readFileSync(path.join(R, p), 'utf-8')

test('路由完整性：App.tsx 注册 7 个模块页面 + 兜底路由', () => {
  const app = read('App.tsx')
  const routes = [...app.matchAll(/path="([^"]*)"\s+element=\{<(\w+)\s*\/>\}/g)]
  const routeMap = new Map(routes.map((m) => [m[1], m[2]]))
  const expected: Array<[string, string]> = [
    ['/', 'OverviewPage'],
    ['/devenv', 'DevEnvPage'],
    ['/daily', 'DailyAppsPage'],
    ['/proxy', 'ProxyAppsPage'],
    ['/edge', 'BrowserPage'],
    ['/tools', 'SystemToolsPage'],
    ['/wallpaper', 'WallpaperPage']
  ]
  for (const [p, comp] of expected) {
    assert.equal(routeMap.get(p), comp, `路由 ${p} 应映射到 ${comp}`)
  }
  assert.ok(app.includes('path="*"'), '应有兜底路由')
})

test('侧边导航 7 项与路由一一对应（P0-11）', () => {
  // 视觉重构后导航元数据单一来源：routes.ts（Sidebar 消费同一份）
  const routes = read('routes.ts')
  for (const label of ['概览', '开发环境', '日常软件', '翻墙软件', '浏览器定制', '系统工具', '壁纸']) {
    assert.ok(routes.includes(`label: '${label}'`), `导航元数据缺 ${label}`)
  }
  for (const p of ["'/'", "'/devenv'", "'/daily'", "'/proxy'", "'/edge'", "'/tools'", "'/wallpaper'"]) {
    assert.ok(routes.includes(`path: ${p}`), `导航元数据缺路由 ${p}`)
  }
  const sidebar = read('components/Sidebar.tsx')
  assert.match(sidebar, /ROUTES/, '侧栏应消费 routes.ts 元数据')
})

test('深色主题落实：深海军蓝玻璃拟态令牌（console-mockup 对齐）', () => {
  const css = read('styles/global.css')
  assert.match(css, /#0b1220/i, '应有深海军蓝背景 #0B1220')
  assert.match(css, /--kd-panel|rgba\(17,24,39/, '应有玻璃面板色')
  assert.match(css, /backdrop-filter/i, '应有玻璃拟态毛玻璃')
  assert.match(css, /#22d3ee/i, '应有青→靛渐变强调色')
  assert.match(css, /--kd-grad|linear-gradient\(135deg,#22D3EE/i, '应有渐变令牌')
  // 状态机微动效：骨架/环形/不定进度/对勾描线/脉冲
  for (const kf of ['kd-shimmer', 'kd-slide', 'kd-draw', 'kd-pl', 'kd-enter']) {
    assert.ok(css.includes(kf), `缺少动效 ${kf}`)
  }
  // 窗口背景（main 进程）
  const main = fs.readFileSync(path.join(SRC, 'main/index.ts'), 'utf-8')
  assert.match(main, /backgroundColor: '#0B1220'/i, 'BrowserWindow 背景应为深海军蓝')
  // Tailwind 令牌
  const tailwind = fs.readFileSync(path.join(process.cwd(), 'tailwind.config.js'), 'utf-8')
  assert.match(tailwind, /#0B1220/i)
  assert.match(tailwind, /#6366F1/i, '应有靛蓝强调色')
})

test('批量安装交互：勾选/全选/进度/日志四要素齐备（P0-5）', () => {
  // 勾选与全选
  const store = read('store/tasksStore.ts')
  assert.match(store, /toggle|setSelection/, 'store 应支持勾选切换')
  assert.match(store, /selectedIds/, '应能取选中集合')
  // 视觉重构后批量动作收口到底部 Dock（原型 #dock）
  const dock = read('components/Dock.tsx')
  assert.match(dock, /全选本页/, 'Dock 应有「全选本页」交互')
  assert.match(dock, /setSelection/, 'Dock 应调用 setSelection')
  assert.match(dock, /await run\(/, 'Dock 应能发起批量安装')
  assert.match(dock, /selectedIds\.length/, '应显示已选数量')
  assert.match(dock, /重试失败/, 'Dock 应有重试失败入口（P2-4）')
  assert.match(dock, /kd-ring/, 'Dock 应有环形总进度')
  // 进度：卡片环形进度 + 不定进度条
  const card = read('components/AppCard.tsx')
  assert.match(card, /progress/, '卡片应显示进度')
  assert.match(card, /kd-ring|kd-bar|kd-pulse|kd-sk/, '卡片状态区应具备各态形态')
  const pill = read('components/StatusPill.tsx')
  for (const st of ['pending', 'downloading', 'installing', 'verifying', 'success', 'manual-needed', 'failed']) {
    assert.ok(pill.includes(st), `状态徽章应覆盖 ${st}`)
  }
  // 日志抽屉
  const drawer = read('components/LogDrawer.tsx')
  assert.match(drawer, /exportLog|导出/, '日志抽屉应支持导出 txt（P2-3）')
  const logStore = read('store/logStore.ts')
  assert.match(logStore, /1000/, '日志缓冲应保留最近 1000 条')
})

test('失败重试入口（P2-4）：页面对 failed/manual-needed 提供重试', () => {
  const store = read('store/tasksStore.ts')
  assert.match(store, /retry/, 'store 应暴露 retry')
  const card = read('components/AppCard.tsx')
  assert.match(card, /TASKS_RUN|retry/, '卡片应有安装/重试按钮')
})

test('首次 Edge 引导弹窗（P1-2）：首次弹出、一键执行、完成后不再弹出、可重置', () => {
  const app = read('App.tsx')
  assert.match(app, /ONBOARD_GET/, '启动时应查询引导标记')
  assert.match(app, /setOnboardingOpen\(true\)/, '未完成引导时应弹窗')
  const modal = read('components/OnboardingModal.tsx')
  assert.match(modal, /EDGE_CUSTOMIZE/, '引导应能一键执行 Edge 定制')
  assert.match(modal, /ONBOARD_DONE/, '完成后应写入标记')
  // IPC：reset 支持
  const register = fs.readFileSync(path.join(SRC, 'main/ipc/registerIpc.ts'), 'utf-8')
  assert.match(register, /reset/, 'ONBOARD_DONE 应支持 reset 重置标记')
})

test('危险操作二次确认（禁用更新/删输入法相关/系统激活/taskkill explorer）', () => {
  const tools = read('pages/SystemToolsPage.tsx')
  // 系统激活必须确认（P1-3 管理员启动）
  assert.match(tools, /requestConfirm/, '系统工具页应使用确认弹窗')
  const activationTile = tools.slice(tools.indexOf("'activation'"), tools.indexOf("'activation'") + 800)
  assert.match(activationTile, /confirm:/, '系统激活应有 confirm 配置')
  assert.match(activationTile, /管理员权限/, '系统激活说明应注明管理员权限')
  // badge-remove / rebuild-icon-cache 都有 confirm
  for (const tool of ["'badge-remove'", "'shield-remove'", "'badge-restore'", "'shield-restore'", "'rebuild-icon-cache'"]) {
    const seg = tools.slice(tools.indexOf(tool), tools.indexOf(tool) + 700)
    assert.match(seg, /confirm:/, `${tool} 应有二次确认`)
  }
  // ConfirmDialog 组件存在于 App 骨架
  const app = read('App.tsx')
  assert.match(app, /<ConfirmDialog\s*\/>/, 'App 应挂载 ConfirmDialog')
  assert.match(app, /<OnboardingModal\s*\/>/, 'App 应挂载 OnboardingModal')
})

test('Edge 页交互：Edge 运行中警告 + 关闭 Edge 需确认 + 至少勾选一项', () => {
  const page = read('pages/BrowserPage.tsx')
  assert.match(page, /请先关闭 Edge/, 'Edge 运行中应提示')
  assert.match(page, /requestConfirm/, '强制关闭 Edge 应二次确认')
  assert.match(page, /EDGE_CLOSE/, '应调用关闭 Edge 通道')
  assert.match(page, /请至少勾选一项/, '无勾选时应提示')
  assert.match(page, /disabled=\{running \|\| Boolean\(edgeRunning\)\}/, 'Edge 运行中定制按钮应禁用')
})

test('日常软件页：方案保存/加载（P2-1）+ 特殊项说明', () => {
  const page = read('pages/DailyAppsPage.tsx')
  assert.match(page, /PLAN_SAVE/, '应支持保存方案')
  assert.match(page, /PLAN_LOAD/, '应支持加载方案')
  assert.match(page, /静默安装/, '应说明静默安装到指定磁盘')
  // 批量勾选/开始安装已收口到底部 Dock（不再页内 BulkBar）
  const dock = read('components/Dock.tsx')
  assert.match(dock, /开始安装/, 'Dock 应提供开始安装')
})

test('概览页仪表盘：系统信息 + 完成度汇总（P1-5）', () => {
  const page = read('pages/OverviewPage.tsx')
  assert.match(page, /SYSTEM_INFO/, '应拉取系统信息')
  assert.match(page, /isAdmin|管理员/, '应显示管理员状态')
  assert.match(page, /percent|完成度|categorySummary/, '应显示完成度汇总')
})

test('壁纸页（v1.1.0）：仅 Wallhaven 单来源 + 网格下方分页 + 无 Cookie/代理硬门槛', () => {
  const page = read('pages/WallpaperPage.tsx')
  // 单来源：Wallhaven 列表与下载链路
  assert.match(page, /WALLHAVEN_LIST/, '应调用 Wallhaven 列表通道')
  assert.match(page, /WALLHAVEN_SET/, '应调用 Wallhaven 下载并设壁纸通道')
  // 分页（修复三）：last_page 全量解析 + pager 含「共 M 页」
  assert.match(page, /lastPage/, '应消费服务端 lastPage')
  assert.match(page, /共/, 'pager 应显示「共 M 页」')
  // 移除项（改动二）：双 Tab / 来源切换 / Cookie / 需代理加速 chip / 彼岸图网
  assert.doesNotMatch(page, /netbian|NETBIAN|彼岸图/, 'netbian 应彻底移除')
  assert.doesNotMatch(page, /本机素材/, '本机素材 Tab 应移除')
  assert.doesNotMatch(page, /需代理加速/, '「需代理加速」chip 应移除')
  assert.doesNotMatch(page, /[Cc]ookie/, 'Cookie 弹层与登录入口应移除')
  assert.doesNotMatch(page, /no-proxy/, 'no-proxy 硬阻断应移除')
})

test('渲染进程安全基线：contextIsolation + nodeIntegration:false + 白名单 invoke', () => {
  const main = fs.readFileSync(path.join(SRC, 'main/index.ts'), 'utf-8')
  assert.match(main, /contextIsolation: true/)
  assert.match(main, /nodeIntegration: false/)
  const preload = fs.readFileSync(path.join(SRC, 'preload/index.ts'), 'utf-8')
  assert.match(preload, /INVOKE_CHANNELS\.includes/, 'preload 必须白名单校验通道')
})

test('视觉重构落地：控制台外壳组件与 store 接线完整', () => {
  const app = read('App.tsx')
  for (const c of ['Sidebar', 'TopBar', 'Dock', 'LogDrawer', 'ToastHost', 'ConfirmDialog', 'OnboardingModal']) {
    assert.match(app, new RegExp(`<${c}\\s*/>`), `App 应挂载 ${c}`)
  }
  // 日志抽屉默认收起（由 Dock「日志」按钮唤出）
  const ui = read('store/uiStore.ts')
  assert.match(ui, /logOpen: false/, '日志抽屉应默认收起')
  assert.match(ui, /closing/, 'Toast 应有退场动画标记')
  // 顶栏：三格计数滚动 + 代理/快捷方式/开机启动开关
  const top = read('components/TopBar.tsx')
  for (const label of ['代理加速', '创建快捷方式', '开机启动']) {
    assert.ok(top.includes(label), `顶栏缺开关 ${label}`)
  }
  assert.match(top, /requestAnimationFrame/, '顶栏数字应有滚动动画')
  // Dock：环形进度 + 全局开关
  const dock = read('components/Dock.tsx')
  assert.match(dock, /kd-ring/, 'Dock 应有环形进度')
  assert.match(dock, /快捷方式/, 'Dock 应含快捷方式开关（与顶栏成对）')
  // 安装选项与代理设置共享 store 并持久化
  assert.match(read('store/optionsStore.ts'), /OPTIONS_SET/, '安装选项应持久化')
  assert.match(read('store/proxyStore.ts'), /PROXY_SET_SETTINGS/, '代理设置应持久化')
  // 路由元数据单一来源
  assert.match(read('routes.ts'), /metaOf/, '应提供路由元数据查询')
  // 新增组件存在、旧的页内工具条已移除（避免双份批量入口）
  for (const f of ['components/Icons.tsx', 'components/Toggle.tsx', 'components/StatusPill.tsx']) {
    assert.ok(fs.existsSync(path.join(R, f)), `应存在 ${f}`)
  }
  for (const f of ['components/BulkBar.tsx', 'components/StatusBadge.tsx', 'components/LogPanel.tsx']) {
    assert.ok(!fs.existsSync(path.join(R, f)), `${f} 应已移除`)
  }
})
