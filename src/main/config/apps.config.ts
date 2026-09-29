/**
 * 日常软件安装配置（20 项，按桌面 日常软件.txt 逐项预置）。
 * v1.0.2：全部改为自动解析最新版并安装到 D:\Apps\<id>，删除全部 kind:'none'，
 * degrade 收敛为 none（仅比特浏览器保留 browser —— 官方图形验证码客观不可程序化）。
 * 解析器以命名函数注册（ARCH 共享知识 #9）；联网解析结论来自侦察线实测。
 * 说明：silentArgs === undefined 表示纯下载/解压任务；'' 表示无参运行安装器。
 */
import type { InstallConfig } from '@shared/types'
import { fetchJson, fetchText, postJson, resolveLocation } from '../core/downloader'
import type { ResolverFn } from '../engine/installer'

/** 从 URL 提取文件名（剥离查询串），供解析器复用（避免与 installer 循环依赖） */
function nameFromUrl(url: string, fallback = 'setup.exe'): string {
  try {
    const p = decodeURIComponent(new URL(url).pathname)
    const n = p.split('/').pop()
    return n && n.length > 0 ? n : fallback
  } catch {
    return fallback
  }
}

export const appsResolvers: Record<string, ResolverFn> = {
  /** 微信：抓官网当前 64 位版链接（避免命中已停更的 32 位 3.9.12 分支），失败回退固定 64 位直链 */
  wechatResolver: async () => {
    const FALLBACK = 'https://dldir1v6.qq.com/weixin/Universal/Windows/WeChatWin_4.1.15.exe'
    try {
      const html = await fetchText('https://pc.weixin.qq.com/')
      const m = html.match(
        /https:\/\/dldir1v6\.qq\.com\/weixin\/Universal\/Windows\/WeChatWin_[\d.]+\.exe/i
      )
      if (m) return { url: m[0], filename: nameFromUrl(m[0], 'WeChatWin.exe') }
    } catch {
      /* 官网不可达时回退固定 64 位直链 */
    }
    return { url: FALLBACK, filename: nameFromUrl(FALLBACK, 'WeChatWin.exe') }
  },

  /** QQ：pcConfig.json 取 ntDownloadX64Url → 官方签名接口换可下载直链；失败回退经典版 downloadUrl */
  qqResolver: async () => {
    const cfg = await fetchJson<{
      Windows?: { ntDownloadX64Url?: string; downloadUrl?: string }
    }>('https://qq-web.cdn-go.cn/im.qq.com_new/latest/rainbow/pcConfig.json')
    const x64 = cfg.Windows?.ntDownloadX64Url
    if (x64) {
      try {
        const signed = await postJson<{ data?: { url?: string } }>(
          'https://im.qq.com/http2rpc/gotrpc/noauth/trpc.qqntv2.urlsign.UrlSign/GetSign',
          { url: x64 },
          { 'x-oidb': '{"uint32_command":"0x9b8e","uint32_service_type":1}' }
        )
        const u = signed.data?.url
        if (u) return { url: u, filename: nameFromUrl(u, 'QQSetup.exe') }
      } catch {
        /* 签名接口异常时退回经典版直链 */
      }
    }
    const classic = cfg.Windows?.downloadUrl
    if (!classic) throw new Error('QQ pcConfig 未返回下载地址')
    return { url: classic, filename: nameFromUrl(classic, 'QQSetup.exe') }
  },

  /** 微信输入法：显式匹配页面 JSON "latest" 键（不用宽泛的第一个 exe 正则） */
  imeResolver: async () => {
    const html = await fetchText('https://z.weixin.qq.com/')
    const m = html.match(
      /"latest":"(https:\/\/download\.z\.weixin\.qq\.com\/app\/win\/[^"]+\.exe)"/
    )
    if (!m) throw new Error('微信输入法官网未解析到 latest 安装包直链')
    return { url: m[1], filename: nameFromUrl(m[1], 'WeChatTypeSetup.exe') }
  },

  /** 百度网盘：cmsdata 接口取 guanjia.url_2（x64 专用）优先，回退 guanjia.url（实测字段名为 guanjia） */
  baiduResolver: async () => {
    const data = await fetchJson<{
      guanjia?: { url?: string; url_2?: string }
      guanji?: { url?: string; url_2?: string }
    }>(
      `https://pan.baidu.com/disk/cmsdata?clienttype=0&app_id=250528&web=1&t=${Date.now()}&adCode=1&do=client`
    )
    const g = data.guanjia ?? data.guanji
    const url = g?.url_2 ?? g?.url
    if (!url) throw new Error('百度网盘 cmsdata 未返回下载地址')
    return { url, filename: nameFromUrl(url, 'BaiduNetdisk.exe') }
  },

  /** 网易云音乐：接口为 302 重定向 → 取 Location；保留 JSON downloadUrl 分支容错 */
  neteaseResolver: async () => {
    const api = 'https://music.163.com/api/pc/download/latest'
    try {
      const loc = await resolveLocation(api)
      if (/\.exe(\?|$)/i.test(loc)) {
        return { url: loc, filename: nameFromUrl(loc, 'cloudmusic.exe') }
      }
    } catch {
      /* 继续尝试 JSON 分支 */
    }
    const data = await fetchJson<{ downloadUrl?: string; data?: { downloadUrl?: string } }>(api)
    const url = data.downloadUrl ?? data.data?.downloadUrl
    if (!url) throw new Error('网易云 API 未返回下载地址')
    return { url, filename: nameFromUrl(url, 'cloudmusic.exe') }
  },

  /** workbuddy：官方更新接口取最新安装包 */
  workbuddyResolver: async () => {
    const data = await fetchJson<{ version?: string; url?: string }>(
      'https://www.workbuddy.cn/v2/update?platform=workbuddy-win32-x64-user'
    )
    if (!data.url) throw new Error('workbuddy 更新接口未返回下载地址')
    return { url: data.url, filename: nameFromUrl(data.url, 'workbuddy-setup.exe') }
  },

  /**
   * 向日葵：官方接口取 64 位稳定版 downloadurl。
   * ⚠️ dw.oray.com CDN 对「无 Referer」的请求返回 HTML 反爬页（~155KB），
   * 必须携带官方站 Referer 才返回真正的 exe（MZ / ~198MB）。
   */
  sunloginResolver: async () => {
    const data = await fetchJson<{ downloadurl?: string }>(
      'https://client-webapi.oray.com/softwares/SUNLOGIN_X_WINDOWS?x64=1&versiontype=stable'
    )
    if (!data.downloadurl) throw new Error('向日葵接口未返回下载地址')
    return {
      url: data.downloadurl,
      filename: nameFromUrl(data.downloadurl, 'SunloginClient.exe'),
      headers: { referer: 'https://sunlogin.oray.com/download' }
    }
  },

  /** uTools：下载页解析版本号后拼官方直链（需跟随 302） */
  utoolsResolver: async () => {
    const html = await fetchText('https://www.u-tools.cn/download/')
    const m = html.match(/uTools-([\d.]+)\.exe/i)
    if (!m) throw new Error('uTools 下载页未解析到版本号')
    const url = `https://open.u-tools.cn/download/uTools-${m[1]}.exe`
    return { url, filename: `uTools-${m[1]}.exe` }
  },

  /**
   * 动漫共和国：官网取 autoglm-agent 托管 zip 链接。
   * ⚠️ href 含中文路径，下载前必须 encodeURI。
   */
  dmghResolver: async () => {
    const html = await fetchText('https://www.dmghg.com/')
    const m = html.match(/href="(https:\/\/autoglm-agent\.aminer\.cn\/[^"]+\.zip)"/)
    if (!m) throw new Error('动漫共和国官网未解析到 zip 链接')
    const raw = m[1]
    return { url: encodeURI(raw), filename: nameFromUrl(raw, 'dmgh-win.zip') }
  },

  /**
   * VLC：last 目录解析版本 + 多镜像候选 + 完整浏览器头（官方站 ?direct 会 302 到反爬挑战页）。
   */
  vlcResolver: async () => {
    const html = await fetchText('https://get.videolan.org/vlc/last/win64/')
    const m = html.match(/vlc-([\d.]+)-win64\.exe/i)
    if (!m) throw new Error('VLC 镜像未解析到 win64 安装包')
    const name = m[0]
    const ver = m[1]
    // 2026-09 实测：官方 get.videolan.org 会 302 到反爬挑战页（text/html），
    // USTC=403、TUNA 路径改版后为 200、nluug 路径失效=404。以下镜像已逐一实测：
    //   status 200/206 · content-type application/octet-stream · 首字节 4D5A(MZ) · 同一 ETag
    // 顺序即优先级：主 URL（官方）失败后依次尝试。
    const mirrors = [
      `https://mirrors.tuna.tsinghua.edu.cn/videolan-ftp/vlc/${ver}/win64/${name}`,
      `https://ftp.halifax.rwth-aachen.de/videolan/vlc/${ver}/win64/${name}`,
      `https://ftp.lysator.liu.se/pub/videolan/vlc/${ver}/win64/${name}`,
      `https://mirrors.ustc.edu.cn/videolan-ftp/vlc/${ver}/win64/${name}`,
      `https://mirror.aarnet.edu.au/pub/videolan/vlc/${ver}/win64/${name}`,
      `https://ftp.nluug.nl/pub/videolan/vlc/${ver}/win64/${name}`
    ]
    return {
      url: `https://get.videolan.org/vlc/${ver}/win64/${name}`,
      filename: name,
      mirrors,
      headers: { referer: 'https://www.videolan.org/vlc/', range: 'bytes=0-' }
    }
  },

  /** 比特浏览器：官网下载强制阿里云图形验证码（携带会失败），保留解析供降级提示 */
  bitbrowserResolver: async () => {
    const html = await fetchText('https://www.bitbrowser.cn/download')
    const m = html.match(/https?:\/\/[^"'<>\s]+\.exe/i)
    if (!m) throw new Error('比特浏览器官网未解析到下载直链')
    return { url: m[0], filename: nameFromUrl(m[0], 'BitBrowser.exe') }
  },

  /** IDM：官网 download.html 解析 idmanXbuildY.exe（HTTPS 不通时下载层自动回退 http） */
  idmResolver: async () => {
    const html = await fetchText('https://www.internetdownloadmanager.com/download.html')
    const m = html.match(/idman\d+build\d+\.exe/i)
    if (!m) throw new Error('IDM 官网未解析到安装包直链')
    const filename = m[0].toLowerCase()
    return { url: `https://download.internetdownloadmanager.com/${filename}`, filename }
  }
}

export const appsConfigs: InstallConfig[] = [
  {
    id: 'qq',
    name: 'QQ',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'qqResolver' },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://im.qq.com/index/'
  },
  {
    id: 'wechat',
    name: '微信',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'wechatResolver' },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://pc.weixin.qq.com/'
  },
  {
    id: 'wechat-ime',
    name: '微信输入法',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'imeResolver' },
    silentArgs: '/S',
    postActions: [{ type: 'cleanup-ime' }],
    degrade: 'none',
    homepage: 'https://z.weixin.qq.com/'
  },
  {
    id: 'baidu-netdisk',
    name: '百度网盘',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'baiduResolver' },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://pan.baidu.com/download#win'
  },
  {
    id: 'netease-music',
    name: '网易云音乐',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'neteaseResolver' },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://music.163.com/#/download'
  },
  {
    id: 'workbuddy',
    name: 'workbuddy',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'workbuddyResolver' },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://copilot.tencent.com/work/'
  },
  {
    id: 'chrome',
    name: 'Chrome',
    category: 'daily',
    // 官方标准“最新版独立包”固定直链（MSI 不支持自定义 INSTALLDIR，固定装到 Program Files，属预期行为）
    source: {
      kind: 'direct-url',
      url: 'https://dl.google.com/dl/chrome/install/googlechromestandaloneenterprise64.msi'
    },
    silentArgs: '/qn',
    degrade: 'none',
    homepage: 'https://www.google.com/chrome/'
  },
  {
    id: 'obs',
    name: 'OBS Studio',
    category: 'daily',
    source: {
      kind: 'github-release',
      repo: 'obsproject/obs-studio',
      assetPattern: '^OBS-Studio-[\\d.]+-Windows-x64-Installer\\.exe$'
    },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://obsproject.com/'
  },
  {
    id: 'localsend',
    name: 'LocalSend',
    category: 'daily',
    source: {
      kind: 'github-release',
      repo: 'localsend/localsend',
      assetPattern: '^LocalSend-[\\d.]+-windows-x86-64\\.exe$'
    },
    silentArgs: '/VERYSILENT /NORESTART',
    degrade: 'none',
    homepage: 'https://localsend.org/zh-CN/download'
  },
  {
    id: 'wujie',
    name: '无界趣连2.0',
    category: 'daily',
    // 64 位固定安装包永久路径；文件名取 ?n= 前的基名（filenameFromUrl 已剥离查询串）
    source: {
      kind: 'direct-url',
      url: 'https://win.os-os.com/rcmnq/remote/wujieinst.exe?n=wjql_cn_3000_inst.exe'
    },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://www.os-os.com/download/'
  },
  {
    id: 'vlc',
    name: 'VLC 播放器',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'vlcResolver' },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://www.videolan.org/vlc/'
  },
  {
    id: 'sunlogin',
    name: '向日葵',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'sunloginResolver' },
    // 向日葵为「引导器」形态：父进程立即返回 1 并异步拉起 GUI 子进程，
    // /S 无法真正静默（实测各种静默参数均 exit 1、不落地安装）。
    // → 保留 /S 尝试；失败后仅标 manual-needed，**不再 openPath 打开安装包**
    //   （该引导器已自行弹出 GUI 安装窗口，再打开会重复弹窗，v1.0.2 修复）。
    silentArgs: '/S',
    degrade: 'wizard',
    wizardSelfLaunched: true,
    homepage: 'https://sunlogin.oray.com/download?ici=sunlogin_navigation'
  },
  {
    id: 'todesk',
    name: 'ToDesk',
    category: 'daily',
    // 固定路径永久 latest（x64 专用包）
    source: { kind: 'direct-url', url: 'https://dl.todesk.com/windows/ToDesk_Setup_x64.exe' },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://www.todesk.com/'
  },
  {
    // P0-7：Geek 卸载（zip 绿色版）下载到桌面并重命名；改官方 zip 直链（原 download?version 返回 HTML）
    id: 'geek',
    name: 'Geek 卸载',
    category: 'daily',
    source: { kind: 'direct-url', url: 'https://geekuninstaller.com/geek.zip' },
    downloadDir: 'desktop',
    renameTo: 'Geek卸载.zip',
    degrade: 'none',
    homepage: 'https://geekuninstaller.com/'
  },
  {
    id: 'utools',
    name: 'uTools',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'utoolsResolver' },
    silentArgs: '/S',
    degrade: 'none',
    homepage: 'https://www.u-tools.cn/download/'
  },
  {
    // 24 项中唯一客观不可程序化项：官方下载强制阿里云图形验证码
    id: 'bitbrowser',
    name: '比特浏览器',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'bitbrowserResolver' },
    silentArgs: '/S',
    degrade: 'browser',
    homepage: 'https://www.bitbrowser.cn/download',
    manualHint: '比特浏览器官网下载强制图形验证码（官方风控），无法自动下载，请在弹出的官网中手动完成验证后下载'
  },
  {
    // P0-7：Windows 概念版 zip，下载后解压到 D:\Apps\动漫共和国
    id: 'dmgh',
    name: '动漫共和国',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'dmghResolver' },
    extractZip: '动漫共和国',
    // zip 里是 NSIS 安装器本体（32 位外壳包 AMD64 载荷）：解压后自动静默安装到 D:\Apps\dmgh
    runExtractedInstaller: { pattern: 'setup.*\\.exe$', silentArgs: '/S', installDirStyle: 'nsis' },
    degrade: 'none',
    homepage: 'https://www.dmghg.com/'
  },
  {
    // P0-7：IDM 破解补丁（本地素材）复制到桌面并重命名"IDM破解.exe"
    id: 'idm-crack',
    name: 'IDM 破解补丁',
    category: 'daily',
    source: { kind: 'local-file', localPath: 'IDM_6.4x_Crack_v20.6.exe' },
    downloadDir: 'desktop',
    renameTo: 'IDM破解.exe',
    degrade: 'none'
  },
  {
    id: 'idm',
    name: 'IDM',
    category: 'daily',
    source: { kind: 'url-resolver', resolver: 'idmResolver' },
    silentArgs: '',
    // 官方安装器无真正静默包 → 打开已下载的本地安装包向导（非“去官网手动下载”）
    degrade: 'wizard',
    homepage: 'https://www.internetdownloadmanager.com/download.html'
  },
  {
    // P0-6：蓝山看图王本地安装包
    id: 'lanshan',
    name: '蓝山看图王',
    category: 'daily',
    source: { kind: 'local-file', localPath: '蓝山看图王-1.0.3.21021.exe' },
    silentArgs: '',
    degrade: 'wizard',
    homepage: ''
  }
]
