/**
 * 19+1 项日常软件 InstallConfig 静态核对：
 * 与 日常软件.txt 逐项对照名称、特殊落地规则、本地包存在性、降级策略完整性。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bundleModule, makeTmpDir, ASSET_ROOT } from './helpers/bundle.mts'

const tmpOut = makeTmpDir('kd-appscfg-')

// 入口虚拟文件：聚合三份配置与解析器注册表
const entry = path.join(tmpOut, 'entry-configs.mts')
fs.writeFileSync(
  entry,
  [
    `export { appsConfigs, appsResolvers } from '${path.join(process.cwd(), 'src/main/config/apps.config.ts').replace(/\\/g, '/')}'`,
    `export { proxyAppsConfigs } from '${path.join(process.cwd(), 'src/main/config/proxyApps.config.ts').replace(/\\/g, '/')}'`,
    `export { devEnvConfigs, devEnvResolvers } from '${path.join(process.cwd(), 'src/main/config/devEnv.config.ts').replace(/\\/g, '/')}'`
  ].join('\n')
)

// 注意：apps.config 引用 '../core/downloader' 与 '../engine/installer'(type-only)。
// bundle 时 stub 掉 downloader；installer 为纯类型导入不会打包。
const mod = await bundleModule(entry, { tmpOut, name: 'configs' })
const { appsConfigs, appsResolvers, proxyAppsConfigs, devEnvConfigs, devEnvResolvers } =
  await import(mod)

const TXT = fs.readFileSync('C:\\Users\\Administrator\\Desktop\\日常软件.txt', 'utf-8')

/** txt 行名 → 期望配置名（允许显示名优化，但必须一一对应） */
const EXPECTED_MAPPING: Array<[string, string]> = [
  ['qq', 'QQ'],
  ['微信', '微信'],
  ['微信输入法', '微信输入法'],
  ['百度网盘', '百度网盘'],
  ['网易云音乐', '网易云音乐'],
  ['workbuddy', 'workbuddy'],
  ['chrome', 'Chrome'],
  ['obs', 'OBS Studio'],
  ['localsend', 'LocalSend'],
  ['无界趣连2.0', '无界趣连2.0'],
  ['vlc播放器', 'VLC 播放器'],
  ['向日葵', '向日葵'],
  ['ToDesk', 'ToDesk'],
  ['geek卸载', 'Geek 卸载'],
  ['utools', 'uTools'],
  ['比特浏览器', '比特浏览器'],
  ['动漫共和国', '动漫共和国'],
  ['idm破解', 'IDM 破解补丁'],
  ['idm', 'IDM'],
  ['蓝山看图王', '蓝山看图王']
]

test('数量：txt 20 行 → appsConfigs 20 项，且 id 无重复', () => {
  const txtLines = TXT.split('\n').filter((l) => l.includes('：'))
  assert.equal(appsConfigs.length, 20, `应有 20 项，实际 ${appsConfigs.length}`)
  assert.equal(txtLines.length, 20)
  const ids = new Set(appsConfigs.map((c) => c.id))
  assert.equal(ids.size, 20)
})

test('逐项名称与 日常软件.txt 一一对应（顺序无关）', () => {
  const byName = new Map(appsConfigs.map((c) => [c.name, c]))
  for (const [txtName, cfgName] of EXPECTED_MAPPING) {
    assert.ok(TXT.includes(txtName + '：'), `txt 应含 ${txtName}`)
    assert.ok(byName.has(cfgName), `配置中缺 ${cfgName}`)
  }
  assert.equal(byName.size, 20)
})

test('特殊落地规则：Geek → 桌面重命名（P0-7）且使用官方 zip 直链', () => {
  const geek = appsConfigs.find((c) => c.id === 'geek')
  assert.equal(geek.downloadDir, 'desktop')
  assert.equal(geek.renameTo, 'Geek卸载.zip')
  assert.equal(geek.silentArgs, undefined, 'Geek 为纯下载任务（silentArgs undefined）')
  assert.equal(geek.source.kind, 'direct-url')
  assert.equal(geek.source.url, 'https://geekuninstaller.com/geek.zip')
})

test('特殊落地规则：IDM破解 → 本地包复制到桌面并重命名“IDM破解”（P0-7）', () => {
  const cfg = appsConfigs.find((c) => c.id === 'idm-crack')
  assert.equal(cfg.source.kind, 'local-file')
  assert.equal(cfg.downloadDir, 'desktop')
  assert.equal(cfg.renameTo, 'IDM破解.exe')
  assert.equal(cfg.silentArgs, undefined)
  // 本地素材真实存在
  const p = path.join(ASSET_ROOT, cfg.source.localPath)
  assert.ok(fs.existsSync(p), `本地素材缺失: ${p}`)
})

test('特殊落地规则：动漫共和国 → zip 解压到桌面目录（P0-7）', () => {
  const cfg = appsConfigs.find((c) => c.id === 'dmgh')
  assert.equal(cfg.source.kind, 'url-resolver')
  assert.equal(cfg.extractZip, '动漫共和国')
  assert.equal(cfg.silentArgs, undefined, 'zip 任务不执行静默安装')
})

test('特殊落地规则：微信输入法 → cleanup-ime 后置动作（P0-8）', () => {
  const cfg = appsConfigs.find((c) => c.id === 'wechat-ime')
  assert.deepEqual(cfg.postActions, [{ type: 'cleanup-ime' }])
})

test('特殊落地规则：无界趣连 → 不再硬编码开机自启（用户要求不设开机启动，v1.0.2）', () => {
  const cfg = appsConfigs.find((c) => c.id === 'wujie')
  assert.ok(
    !(cfg.postActions ?? []).some((a) => a.type === 'set-autostart'),
    'wujie 不应再有 set-autostart 后置动作'
  )
  assert.equal(cfg.source.kind, 'direct-url')
  assert.match(cfg.source.url ?? '', /wujieinst\.exe/)
})

test('特殊落地规则：蓝山看图王 → 本地安装包（P0-6）且素材存在', () => {
  const cfg = appsConfigs.find((c) => c.id === 'lanshan')
  assert.equal(cfg.source.kind, 'local-file')
  assert.equal(cfg.source.localPath, '蓝山看图王-1.0.3.21021.exe')
  const p = path.join(ASSET_ROOT, cfg.source.localPath)
  assert.ok(fs.existsSync(p), `本地安装包缺失: ${p}`)
})

test('所有 url-resolver 引用的解析器均已注册（apps + devEnv）', () => {
  const all = [...appsConfigs, ...devEnvConfigs]
  for (const cfg of all) {
    if (cfg.source.kind === 'url-resolver') {
      const name = cfg.source.resolver ?? ''
      assert.ok(
        appsResolvers[name] ?? devEnvResolvers[name],
        `${cfg.id} 引用的解析器 ${name} 未注册`
      )
    }
  }
})

test('所有 browser 降级项均配置了官网 homepage；degrade 取值合法', () => {
  const valid = new Set(['wizard', 'browser', 'none'])
  for (const cfg of appsConfigs) {
    assert.ok(valid.has(cfg.degrade), `${cfg.id}.degrade=${cfg.degrade}`)
    if (cfg.degrade === 'browser') {
      assert.ok(cfg.homepage && cfg.homepage.startsWith('http'), `${cfg.id} 缺 homepage`)
    }
  }
})

test('静默参数约定：undefined=纯下载 / 字符串=安装；安装型都有静默参数', () => {
  for (const cfg of appsConfigs) {
    if (cfg.silentArgs !== undefined) {
      assert.equal(typeof cfg.silentArgs, 'string', `${cfg.id}.silentArgs 类型错误`)
    }
  }
  // IDM 无静默包 → ''（无参运行）
  assert.equal(appsConfigs.find((c) => c.id === 'idm').silentArgs, '')
  // 微信等常规 NSIS → /S
  assert.equal(appsConfigs.find((c) => c.id === 'wechat').silentArgs, '/S')
})

test('翻墙软件配置与 生产力翻墙软件.txt 对应（P0-4；v1.0.2 clash-verge 改为自动跟随最新版）', () => {
  assert.equal(proxyAppsConfigs.length, 4)
  const verge = proxyAppsConfigs.find((c) => c.id === 'clash-verge')
  assert.equal(verge.source.kind, 'github-release', 'clash-verge 应改为 github-release')
  assert.equal(verge.source.repo, 'clash-verge-rev/clash-verge-rev')
  assert.equal(verge.source.assetPattern, '^Clash\\.Verge_[\\d.]+_x64-setup\\.exe$')
  const gh = proxyAppsConfigs.filter((c) => c.source.kind === 'github-release')
  assert.deepEqual(
    gh.map((c) => c.source.repo).sort(),
    ['babygoton/WorkDaddy', 'clash-verge-rev/clash-verge-rev', 'linguo2625469/workbuddy2api-panel']
  )
  // 影策：release 无 Windows 包 → 源码部署包（main.zip）+ 解压
  const yingce = proxyAppsConfigs.find((c) => c.id === 'yingce')
  assert.equal(yingce.source.kind, 'direct-url')
  assert.match(yingce.source.url ?? '', /open-ai-canvas\/archive\/refs\/heads\/main\.zip$/)
  assert.equal(yingce.extractZip, '影策')
  assert.equal(yingce.silentArgs, undefined, 'zip 项 silentArgs 必须为 undefined')
  // txt 中的仓库都在配置里（注意：该 txt 中 clash 一行的斜杠被剥离，故按 owner 片段核对）
  const txt = fs.readFileSync('C:\\Users\\Administrator\\Desktop\\生产力翻墙软件.txt', 'utf-8')
  for (const frag of ['clash-verge-rev', 'babygoton/WorkDaddy', 'linguo2625469/workbuddy2api-panel']) {
    assert.ok(txt.includes(frag), `txt 应含 ${frag}`)
  }
})

/* ---------------- v1.0.2 增量断言 ---------------- */

test('daily 配置完备性：无 kind:none，且除 bitbrowser 外无 degrade:browser', () => {
  for (const cfg of appsConfigs) {
    assert.notEqual(cfg.source.kind, 'none', `${cfg.id} 不应再有 kind:'none'`)
    if (cfg.degrade === 'browser') {
      assert.equal(cfg.id, 'bitbrowser', `仅 bitbrowser 允许 degrade:browser，实际 ${cfg.id}`)
      assert.ok(cfg.manualHint, 'bitbrowser 应有 manualHint 说明官方风控')
    }
  }
  for (const cfg of proxyAppsConfigs) {
    assert.notEqual(cfg.source.kind, 'none', `${cfg.id} 不应再有 kind:'none'`)
    assert.notEqual(cfg.degrade, 'browser', `${cfg.id} 不应再 degrade:browser`)
  }
})

test('全部 GitHub assetPattern 以 ^ 开头、以 $ 结尾（防再次 over-match）', () => {
  const all = [...appsConfigs, ...devEnvConfigs, ...proxyAppsConfigs]
  for (const cfg of all) {
    if (cfg.source.kind === 'github-release') {
      const p = cfg.source.assetPattern ?? ''
      assert.ok(p.startsWith('^'), `${cfg.id} assetPattern 应以 ^ 开头: ${p}`)
      assert.ok(p.endsWith('$'), `${cfg.id} assetPattern 应以 $ 结尾: ${p}`)
    }
  }
})

test('zip 类配置（extractZip）的 silentArgs 必须为 undefined（防把 zip 当安装器执行）', () => {
  const all = [...appsConfigs, ...devEnvConfigs, ...proxyAppsConfigs]
  for (const cfg of all) {
    if (cfg.extractZip) {
      assert.equal(cfg.silentArgs, undefined, `${cfg.id} 为 zip 解压项，silentArgs 必须 undefined`)
    }
  }
})

test('微信指向 64 位最新分支（不得再是 32 位 3.9.12 的 WeChatSetup.exe）', () => {
  const wechat = appsConfigs.find((c) => c.id === 'wechat')
  assert.ok(wechat.source.resolver === 'wechatResolver' || /WeChatWin_/.test(wechat.source.url ?? ''))
})

test('开发四件套校验命令全路径化（PATH 未刷新也能校验）+ 静默参数存在', () => {
  const map: Record<string, RegExp> = {
    go: /go\.exe.*go version|& \$go version/s,
    git: /git\.exe.*git --version|& \$git --version/s,
    python: /python\.exe.*--version|& \$py --version/s,
    node: /node\.exe.*-v|& \$node -v/s
  }
  for (const [id, re] of Object.entries(map)) {
    const cfg = devEnvConfigs.find((c) => c.id === id)
    assert.ok(cfg, `缺开发环境配置 ${id}`)
    assert.ok(re.test(cfg.verify?.command ?? ''), `${id} 校验命令应全路径调用并输出版本: ${cfg.verify?.command}`)
    assert.ok(cfg.verify?.successPattern, `${id} 应有 successPattern`)
    assert.ok(cfg.silentArgs !== undefined, `${id} 应有静默参数`)
  }
  // Git 必须带 Inno PATH 覆盖项（用户要求"一定要勾选添加环境变量"）
  const git = devEnvConfigs.find((c) => c.id === 'git')
  assert.match(
    git?.silentArgs ?? '',
    /\/o:PathOption=CmdTools/,
    `Git 静默参数应含 /o:PathOption=CmdTools: ${git?.silentArgs}`
  )
  // Go/Node 显式 add-path 兜底
  const go = devEnvConfigs.find((c) => c.id === 'go')
  const node = devEnvConfigs.find((c) => c.id === 'node')
  assert.ok((go?.postActions ?? []).some((a) => a.type === 'add-path' && a.dir === 'C:\\Program Files\\Go\\bin'))
  assert.ok((node?.postActions ?? []).some((a) => a.type === 'add-path' && a.dir === 'C:\\Program Files\\nodejs'))
})

test('开发环境第五项 FFmpeg：zip 免安装 + add-path（增量需求）', () => {
  const ff = devEnvConfigs.find((c) => c.id === 'ffmpeg')
  assert.ok(ff, 'devEnvConfigs 应含 ffmpeg')
  assert.equal(ff.category, 'devenv')
  assert.equal(ff.extractZip, 'C:\\ffmpeg')
  assert.ok((ff.postActions ?? []).some((a) => a.type === 'add-path'))
})
