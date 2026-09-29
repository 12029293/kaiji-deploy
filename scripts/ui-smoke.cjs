/**
 * 视觉冒烟（v1.0.9 视觉重构）：加载真实主进程 + 构建产物，逐路由截图并校验交互。
 *
 * 隔离性：userData 重定向到 smoke 临时目录，不污染用户真实设置（首次引导标记 / 安装选项 / 日志）。
 * 安全性：只做「无副作用」交互 —— 勾选、开关（改完复原）、开日志抽屉、打开确认弹窗后点取消。
 *         绝不点击确认按钮，避免真实触发下载安装。
 */
const fs = require('fs')
const path = require('path')
const { app, BrowserWindow } = require('electron')

const PROJ = 'C:/Users/Administrator/Desktop/开机部署/kaiji-deploy'
const OUT = 'C:/kdtest/uidemo'
const USERDATA = path.join(OUT, 'userdata')
fs.mkdirSync(OUT, { recursive: true })

// userData 隔离必须早于主进程模块加载
app.setPath('userData', USERDATA)

// 加载真实主进程（自建窗口 + 注册 IPC + 注册配置）
require(path.join(PROJ, 'out/main/index.js'))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const result = {}

app.whenReady().then(async () => {
  let win = null
  for (let i = 0; i < 80 && !win; i++) {
    win = BrowserWindow.getAllWindows()[0]
    if (!win) await sleep(250)
  }
  if (!win) {
    console.log('SMOKE_FAIL no-window')
    app.quit()
    return
  }

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(String(message))
  })

  win.setSize(1360, 860)
  await sleep(4000)

  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(OUT, name + '.png'), img.toPNG())
  }
  const js = (code) => win.webContents.executeJavaScript(code)

  /* 关掉首次引导弹窗（仅写入隔离的 userData） */
  result.onboardDismissed = await js(`(function(){
    const btns = Array.from(document.querySelectorAll('button'));
    const later = btns.find(b => b.textContent.trim() === '稍后再说');
    if (!later) return false;
    later.click();
    return true;
  })()`)
  await sleep(700)

  const routes = [
    ['01-overview', '#/'],
    ['02-daily', '#/daily'],
    ['03-devenv', '#/devenv'],
    ['04-proxy', '#/proxy'],
    ['05-edge', '#/edge'],
    ['06-tools', '#/tools'],
    ['07-wallpaper', '#/wallpaper']
  ]
  for (const [name, hash] of routes) {
    await js(`location.hash = '${hash}'`)
    await sleep(1300)
    await shot(name)
  }

  /* ---------- 交互 1：勾选（默认全选 → 取消 3 项 → 全选本页复原） ---------- */
  await js(`location.hash = '#/daily'`)
  await sleep(1200)
  const sel0 = await js(`(function(){
    const dock = document.querySelector('.kd-dock');
    return { cards: document.querySelectorAll('article.kd-appcard').length, dockSub: dock.querySelector('small').textContent };
  })()`)
  const sel1 = await js(`(function(){
    const cards = Array.from(document.querySelectorAll('article.kd-appcard')).slice(0, 3);
    cards.forEach(c => c.querySelector('input[type=checkbox]').click());
    return {
      stillSelected: cards.filter(c => c.classList.contains('selected')).length,
      dockSub: document.querySelector('.kd-dock small').textContent
    };
  })()`)
  await sleep(500)
  await shot('08-daily-unselected')
  const sel2 = await js(`(function(){
    const label = Array.from(document.querySelectorAll('.kd-dock label')).find(l => l.textContent.includes('全选本页'));
    if (!label) return { dockSub: 'no-label' };
    label.querySelector('input').click();
    return { dockSub: document.querySelector('.kd-dock small').textContent };
  })()`)
  await sleep(500)
  result.selection = { sel0, sel1, sel2 }
  await shot('09-daily-allselected')

  /* ---------- 交互 2：打开确认弹窗 → 截图 → 取消（绝不确认） ---------- */
  result.dialog = await js(`(function(){
    const start = Array.from(document.querySelectorAll('.kd-dock button')).find(b => b.textContent.includes('开始安装'));
    start.click();
    return { clicked: !!start };
  })()`)
  await sleep(800)
  await shot('10-confirm-dialog')
  result.dialogCancel = await js(`(function(){
    const dlg = Array.from(document.querySelectorAll('.fixed.inset-0')).pop();
    if (!dlg) return { shown: false };
    const title = dlg.querySelector('h3') ? dlg.querySelector('h3').textContent : '';
    const cancel = Array.from(dlg.querySelectorAll('button')).find(b => b.textContent.trim() === '取消');
    if (cancel) cancel.click();
    return { shown: true, title };
  })()`)
  await sleep(500)

  /* ---------- 交互 3：日志抽屉 ---------- */
  await js(`(function(){
    const log = Array.from(document.querySelectorAll('.kd-dock button')).find(b => b.textContent.trim() === '日志');
    log.click();
  })()`)
  await sleep(900)
  result.drawer = await js(`(function(){
    const d = document.querySelector('.kd-drawer');
    return { open: d.classList.contains('open'), lines: d.querySelectorAll('.ln').length };
  })()`)
  await shot('11-log-drawer')
  await js(`(function(){
    const log = Array.from(document.querySelectorAll('.kd-dock button')).find(b => b.textContent.trim() === '日志');
    log.click();
  })()`)
  await sleep(500)

  /* ---------- 交互 4：顶栏开关成对联动 + 复原 ---------- */
  const t0 = await js(`Array.from(document.querySelectorAll('header .kd-switch')).map(s => s.classList.contains('on'))`)
  await js(`document.querySelectorAll('header .kd-switch')[1].click()`)
  await sleep(600)
  const t1 = await js(`Array.from(document.querySelectorAll('header .kd-switch')).map(s => s.classList.contains('on'))`)
  await js(`document.querySelectorAll('header .kd-switch')[1].click()`)
  await sleep(700)
  const t2 = await js(`Array.from(document.querySelectorAll('header .kd-switch')).map(s => s.classList.contains('on'))`)
  await shot('12-after-toggle-restore')
  result.toggles = { initial: t0, afterClick: t1, restored: t2 }

  /* ---------- 交互 5：折叠侧栏（Dock 随内容列重新居中） ---------- */
  await js(`(function(){
    const btn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('收起导航'));
    if (btn) btn.click();
  })()`)
  await sleep(900)
  await shot('13-sidebar-collapsed')
  result.layout = await js(`(function(){
    const dock = document.querySelector('.kd-dock').getBoundingClientRect();
    const nav = document.querySelector('nav').getBoundingClientRect();
    return { navW: Math.round(nav.width), dockLeft: Math.round(dock.left), dockW: Math.round(dock.width), overlap: dock.left < nav.right };
  })()`)
  await js(`(function(){
    const btn = Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('展开导航'));
    if (btn) btn.click();
  })()`)
  await sleep(600)

  result.jsErrors = { count: errors.length, first: errors.slice(0, 6) }
  console.log('SMOKE_RESULT ' + JSON.stringify(result))
  console.log('SMOKE_DONE')
  app.quit()
}).catch((e) => {
  console.log('SMOKE_FAIL ' + (e && e.stack ? e.stack : e))
  app.quit()
})
