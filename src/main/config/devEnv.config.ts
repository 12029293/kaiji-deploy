/**
 * 开发环境四件套（Go / Git / Python / Node.js）安装配置。
 * URL 解析策略 + 静默参数 + 校验命令；解析器以命名函数注册（ARCH 共享知识 #9）。
 */
import type { InstallConfig } from '@shared/types'
import { fetchJson, fetchText, headOk } from '../core/downloader'
import type { ResolverFn } from '../engine/installer'

export const devEnvResolvers: Record<string, ResolverFn> = {
  /** go.dev/dl/?mode=json 官方 JSON API 取最新稳定版 windows-amd64 msi */
  goResolver: async () => {
    const list = await fetchJson<
      Array<{ version: string; files: Array<{ filename: string; os: string; arch: string; kind: string }> }>
    >('https://go.dev/dl/?mode=json')
    const latest = list[0]
    if (!latest) throw new Error('go.dev 返回为空')
    const file = latest.files.find(
      (f) => f.os === 'windows' && f.arch === 'amd64' && f.kind === 'installer'
    )
    if (!file) throw new Error(`go.dev ${latest.version} 未找到 windows-amd64 安装包`)
    return { url: `https://dl.google.com/go/${file.filename}`, filename: file.filename }
  },

  /**
   * v1.0.9 重写（根因：本机链路强制 content-encoding: gzip，downloader 已修复为按头解压）：
   * 首选：endoflife.date/api/python.json → list[0].latest（实测 3.14.7）→
   *      拼 python.org ftp 直链 → HEAD 探测验证通过才采用。
   * 回退：python.org/downloads/windows 页面全局正则取全部 amd64.exe，
   *      按版本号数值比较取最大者（旧实现取第一个匹配，文档序不保证最新）。
   * 两级都失败才 throw。
   */
  pythonResolver: async () => {
    // 首选：endoflife.date JSON API（stable latest 版本号）
    try {
      const list = await fetchJson<Array<{ latest?: string }>>(
        'https://endoflife.date/api/python.json'
      )
      const ver = list?.[0]?.latest
      if (ver && /^\d+\.\d+\.\d+$/.test(ver)) {
        const url = `https://www.python.org/ftp/python/${ver}/python-${ver}-amd64.exe`
        if (await headOk(url)) {
          return { url, filename: `python-${ver}-amd64.exe` }
        }
      }
    } catch {
      // 首选链路失败，落回页面解析
    }
    // 回退：downloads/windows 页面，全部匹配中取版本号最大者
    try {
      const html = await fetchText('https://www.python.org/downloads/windows/')
      const re =
        /https:\/\/www\.python\.org\/ftp\/python\/(\d+)\.(\d+)\.(\d+)\/python-\d+\.\d+\.\d+-amd64\.exe/gi
      let best: { url: string; major: number; minor: number; patch: number } | null = null
      for (const m of html.matchAll(re)) {
        const major = Number(m[1])
        const minor = Number(m[2])
        const patch = Number(m[3])
        if (
          best === null ||
          major > best.major ||
          (major === best.major &&
            (minor > best.minor || (minor === best.minor && patch > best.patch)))
        ) {
          best = { url: m[0], major, minor, patch }
        }
      }
      if (best) {
        const filename = best.url.split('/').pop() ?? 'python-amd64.exe'
        return { url: best.url, filename }
      }
    } catch {
      // 落到统一报错
    }
    throw new Error('Python 版本解析失败：endoflife.date 与 python.org 页面两条链路均不可用')
  },

  /** nodejs.org/dist/index.json 取最新 LTS win-x64 msi */
  nodeResolver: async () => {
    const list = await fetchJson<Array<{ version: string; lts: string | false }>>(
      'https://nodejs.org/dist/index.json'
    )
    const latest = list.find((x) => x.lts !== false) ?? list[0]
    if (!latest) throw new Error('nodejs.org 返回为空')
    const filename = `node-${latest.version}-win-x64.msi`
    return { url: `https://nodejs.org/dist/${latest.version}/${filename}`, filename }
  }
}

export const devEnvConfigs: InstallConfig[] = [
  {
    id: 'go',
    name: 'Go',
    category: 'devenv',
    source: { kind: 'url-resolver', resolver: 'goResolver' },
    silentArgs: '/qn',
    // MSI 理论上自动写 PATH，这里显式兜底（add-path 有去重，不会重复写）
    postActions: [{ type: 'add-path', dir: 'C:\\Program Files\\Go\\bin' }],
    // 校验用全路径调用：安装器写注册表 PATH，当前进程 env 不刷新，裸命令会假失败
    verify: {
      command:
        "$go = @('C:\\Program Files\\Go\\bin\\go.exe','C:\\Go\\bin\\go.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1; if ($go) { & $go version } else { throw 'go.exe not found' }",
      successPattern: 'go version'
    },
    degrade: 'browser',
    homepage: 'https://go.dev/dl/'
  },
  {
    id: 'git',
    name: 'Git',
    category: 'devenv',
    source: {
      kind: 'github-release',
      repo: 'git-for-windows/git',
      assetPattern: '^Git-[\\d.]+-64-bit\\.exe$'
    },
    // /o:PathOption=CmdTools：Inno 覆盖项，勾选"Git from the command line and also from 3rd-party software"
    // （即写入系统 PATH），已用 Git-2.56.0-64-bit.exe /HELP 实证
    silentArgs: '/VERYSILENT /NORESTART /SUPPRESSMSGBOXES /o:PathOption=CmdTools',
    // 显式 add-path 兜底（与 Go/Node 一致；add-path 有去重，不会重复写）
    postActions: [{ type: 'add-path', dir: 'C:\\Program Files\\Git\\cmd' }],
    verify: {
      command:
        "$git = @('C:\\Program Files\\Git\\cmd\\git.exe','C:\\Program Files (x86)\\Git\\cmd\\git.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1; if ($git) { & $git --version } else { throw 'git.exe not found' }",
      successPattern: 'git version'
    },
    degrade: 'browser',
    homepage: 'https://git-scm.com/download/win'
  },
  {
    id: 'python',
    name: 'Python',
    category: 'devenv',
    source: { kind: 'url-resolver', resolver: 'pythonResolver' },
    silentArgs: '/quiet InstallAllUsers=1 PrependPath=1 Include_test=0',
    verify: {
      command:
        "$py = Get-ChildItem 'C:\\Program Files' -Directory -Filter 'Python*' | ForEach-Object { Join-Path $_.FullName 'python.exe' } | Where-Object { Test-Path $_ } | Select-Object -First 1; if ($py) { & $py --version } else { throw 'python.exe not found' }",
      successPattern: 'Python \\d'
    },
    degrade: 'browser',
    homepage: 'https://www.python.org/downloads/windows/'
  },
  {
    id: 'node',
    name: 'Node.js',
    category: 'devenv',
    source: { kind: 'url-resolver', resolver: 'nodeResolver' },
    silentArgs: '/qn',
    // MSI 理论上自动写 PATH，这里显式兜底（add-path 有去重，不会重复写）
    postActions: [{ type: 'add-path', dir: 'C:\\Program Files\\nodejs' }],
    verify: {
      command:
        "$node = 'C:\\Program Files\\nodejs\\node.exe'; if (Test-Path $node) { & $node -v } else { throw 'node.exe not found' }",
      successPattern: '^v\\d+'
    },
    degrade: 'browser',
    homepage: 'https://nodejs.org/zh-cn/download'
  },
  {
    // FFmpeg：gyan.dev release-essentials zip（免安装），解压到 C:\ffmpeg，
    // postAction 自动把 bin 目录加入系统 PATH（zip 内层目录名含版本号，由引擎动态解析），
    // 校验用全路径调用避免依赖当前进程 PATH 刷新。
    id: 'ffmpeg',
    name: 'FFmpeg',
    category: 'devenv',
    // P1 修复（v1.0.5）：旧 repo GyanD/codexyc 已 404（GyanD/ffmpeg-builds 亦 404），
    // 经 GitHub API 实测现行仓库为 GyanD/codexffmpeg（latest 9.0.2），
    // 资产名 ffmpeg-<ver>-essentials_build.zip，旧正则 ^ffmpeg-release-essentials\.zip$ 永不匹配 → 双重失效
    source: {
      kind: 'github-release',
      repo: 'GyanD/codexffmpeg',
      assetPattern: '^ffmpeg-[\\d.]+-essentials_build\\.zip$'
    },
    extractZip: 'C:\\ffmpeg',
    postActions: [{ type: 'add-path', dir: 'C:\\ffmpeg\\bin' }],
    verify: {
      command:
        "if (-not (Test-Path 'C:\\ffmpeg')) { throw 'ffmpeg.exe not found' }; $ff = Get-ChildItem 'C:\\ffmpeg' -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | Select-Object -First 1; if ($ff) { & $ff.FullName -version } else { throw 'ffmpeg.exe not found' }",
      successPattern: 'ffmpeg version'
    },
    degrade: 'browser',
    homepage: 'https://www.gyan.dev/ffmpeg/builds/'
  }
]
