/**
 * 删角标 4 操作 + 图标缓存重建：注册表/命令生成逻辑与素材 删角标.bat / 新图标缓存.bat 原意比对。
 * 工具启动路径（磁贴美化/系统激活/禁用更新）一并验证。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { bundleModule, makeTmpDir, hooks } from './helpers/bundle.mts'

const tmpOut = makeTmpDir('kd-tools-')
const tmpAssets = makeTmpDir('kd-assets-')
const H = hooks()
H.reset()

// 构造素材文件（launchTool 需要真实存在）
fs.mkdirSync(path.join(tmpAssets, '磁贴美化小工具 v4.1.1'), { recursive: true })
fs.writeFileSync(path.join(tmpAssets, '磁贴美化小工具 v4.1.1', '磁贴美化小工具.exe'), 'dummy')
fs.writeFileSync(path.join(tmpAssets, '系统激活.exe'), 'dummy')
fs.mkdirSync(path.join(tmpAssets, '禁用更新'), { recursive: true })
fs.writeFileSync(path.join(tmpAssets, '禁用更新', 'Wub_x64.exe'), 'dummy')

const mod = await bundleModule(
  path.join(process.cwd(), 'src/main/services/systemToolsService.ts'),
  {
    tmpOut,
    name: 'systemToolsService',
    pathsFixture: {
      cache: tmpOut,
      desktop: tmpOut,
      assets: tmpAssets,
      edgeBookmarks: path.join(tmpOut, 'Bookmarks'),
      edgePrefs: path.join(tmpOut, 'Preferences'),
      edgeHtml: ''
    }
  }
)
const { systemToolsService } = await import(mod)

const KEY = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Shell Icons'
const BLANK = '%SystemRoot%\\system32\\imageres.dll,197'

/** bat 原始命令（素材 删角标.bat 提取） */
const BAT = {
  one: [`reg add "${KEY}" /v 29 /d "${BLANK}" /t reg_sz /f`],
  two: [`reg add "${KEY}" /v 29 /d "${BLANK}" /t reg_sz /f`, `reg add "${KEY}" /v 77 /d "${BLANK}" /t reg_sz /f`],
  three: [`reg delete "${KEY}" /v 29 /f`],
  four: [`reg delete "${KEY}" /v 29 /f`, `reg delete "${KEY}" /v 77 /f`]
}

/**
 * 公共刷缓存序列（删角标.bat 每个分支末尾都有：taskkill → attrib+del iconcache → start explorer）。
 * 代码将 attrib 与 del 用 & 合并为一条 cmd，语义与 bat 的两行等价。
 */
const REFRESH = [
  'taskkill /f /im explorer.exe',
  'attrib -s -r -h "%UserProfile%\\AppData\\Local\\iconcache.db"',
  'del "%UserProfile%\\AppData\\Local\\iconcache.db" /f /q',
  'start explorer.exe'
]

function cmds(): string[] {
  return H.commands.map((c) => c.cmd)
}

/** 刷缓存 3 条命令（跳过前 regOffset 条 reg 命令）：taskkill / attrib+del（& 合并）/ start explorer */
const REFRESH_GOT = (regOffset = 0): string[] => {
  const got = cmds()
  const rest = got.slice(regOffset)
  assert.equal(rest.length, 3, `刷缓存应为 3 条命令，实际: ${got.join(' | ')}`)
  assert.match(rest[1], /attrib -s -r -h "%UserProfile%\\AppData\\Local\\iconcache\.db" & del "%UserProfile%\\AppData\\Local\\iconcache\.db" \/f \/q/)
  assert.equal(rest[2], 'start explorer.exe')
  return rest
}

async function run(tool: string): Promise<void> {
  H.commands.length = 0
  const res = await systemToolsService.action(tool)
  assert.equal(res.ok, true, `${tool} 应成功: ${res.output}`)
}

test('badge-remove = bat :one（Shell Icons 29 → imageres.dll,197 + 刷缓存）', async () => {
  await run('badge-remove')
  const got = cmds()
  assert.equal(got[0], BAT.one[0])
  const rest = REFRESH_GOT(1)
  assert.equal(rest[0], 'taskkill /f /im explorer.exe')
})

test('shield-remove = bat :two（29 + 77 → imageres.dll,197）', async () => {
  await run('shield-remove')
  const got = cmds()
  assert.equal(got[0], BAT.two[0])
  assert.equal(got[1], BAT.two[1])
  const rest = REFRESH_GOT(2)
  assert.equal(rest[0], 'taskkill /f /im explorer.exe')
})

test('badge-restore = bat :three（恢复 = 删除 29）', async () => {
  await run('badge-restore')
  const got = cmds()
  assert.equal(got[0], BAT.three[0])
  REFRESH_GOT(1)
})

test('shield-restore = bat :four（恢复 = 删除 29 + 77，可逆）', async () => {
  await run('shield-restore')
  const got = cmds()
  assert.equal(got[0], BAT.four[0])
  assert.equal(got[1], BAT.four[1])
  REFRESH_GOT(2)
})

test('rebuild-icon-cache 覆盖 新图标缓存.bat 全量逻辑（explorer/IconCache/thumbcache/TrayNotify）', async () => {
  await run('rebuild-icon-cache')
  const got = cmds()
  // bat 顺序：taskkill → attrib+del IconCache → attrib Explorer 目录 → del thumbcache → TrayNotify ×2 → start explorer
  assert.equal(got.length, 6, `实际: ${got.join(' | ')}`)
  assert.equal(got[0], 'taskkill /f /im explorer.exe')
  assert.match(got[1], /attrib -h -s -r "%UserProfile%\\AppData\\Local\\IconCache\.db" & del \/f "%UserProfile%\\AppData\\Local\\IconCache\.db"/)
  assert.match(got[2], /attrib \/s \/d -h -s -r "%UserProfile%\\AppData\\Local\\Microsoft\\Windows\\Explorer\\\*"/)
  assert.match(got[3], /del \/f "%UserProfile%\\AppData\\Local\\Microsoft\\Windows\\Explorer\\thumbcache_\*\.db"/)
  // bat 用 echo y| 管道确认删除；代码用 /f 等价
  assert.match(got[4], /TrayNotify/)
  assert.match(got[4], /IconStreams/)
  assert.match(got[4], /PastIconsStream/)
  assert.match(got[4], /\/f/)
  assert.equal(got[5], 'start explorer.exe')
})

test('thumbcache 通配删除覆盖 bat 中列出的全部 7 个 db 文件名', async () => {
  await run('rebuild-icon-cache')
  const thumb = cmds().find((c) => c.includes('thumbcache_'))
  assert.ok(thumb.includes('thumbcache_*.db'), 'bat 逐个删除 32/96/102/256/1024/idx/sr 共 7 个 db，代码用通配符等价覆盖')
})

test('tiles：启动本地磁贴美化工具（工作目录 = exe 所在目录）', async () => {
  await run('tiles')
  const cmd = cmds()[0]
  assert.match(cmd, /Start-Process/)
  assert.match(cmd, /磁贴美化小工具\.exe/)
  assert.match(cmd, /-WorkingDirectory/)
})

test('activation：系统激活以管理员权限启动（-Verb RunAs）', async () => {
  await run('activation')
  const cmd = cmds()[0]
  assert.match(cmd, /Start-Process/)
  assert.match(cmd, /-Verb RunAs/)
  assert.match(cmd, /系统激活\.exe/)
})

test('disable-update / enable-update：启动 Wub_x64.exe', async () => {
  await run('disable-update')
  assert.match(cmds()[0], /Wub_x64\.exe/)
  await run('enable-update')
  assert.match(cmds()[0], /Wub_x64\.exe/)
})

test('程序缺失时提示路径错误（P1-3 验收）', async () => {
  // 删除素材后重试
  fs.rmSync(path.join(tmpAssets, '系统激活.exe'), { force: true })
  H.commands.length = 0
  const res = await systemToolsService.action('activation')
  assert.equal(res.ok, false)
  assert.match(res.output, /程序不存在/)
  assert.equal(H.commands.length, 0, '缺失时不应执行任何命令')
})

test('未知工具返回失败', async () => {
  const res = await systemToolsService.action('no-such-tool' as never)
  assert.equal(res.ok, false)
})
