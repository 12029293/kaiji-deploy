/**
 * 路由/导航元数据单一来源：侧栏、顶栏标题、Dock 作用域三处共用，避免文案漂移。
 */
import type { Category } from '@shared/types'
import type { IconName } from './components/Icons'

export interface RouteMeta {
  path: string
  label: string
  sub: string
  icon: IconName
  /** 该页面对应的软件分类 —— Dock「全选本页」与批量动作的作用域 */
  category?: Category
}

export const ROUTES: RouteMeta[] = [
  {
    path: '/',
    label: '概览',
    sub: '新机开机到可用环境 · 勾选式批量部署',
    icon: 'layout'
  },
  {
    path: '/devenv',
    label: '开发环境',
    sub: 'SDK 与运行时 · 安装完自动追加系统 PATH',
    icon: 'terminal',
    category: 'devenv'
  },
  {
    path: '/daily',
    label: '日常软件',
    sub: '全自动解析官网/GitHub 最新版 · 静默安装到指定磁盘',
    icon: 'grid',
    category: 'daily'
  },
  {
    path: '/proxy',
    label: '翻墙软件',
    sub: '代理内核与工作台 · 跟随最新 Release',
    icon: 'globe',
    category: 'proxy'
  },
  {
    path: '/edge',
    label: '浏览器定制',
    sub: '导入收藏夹 · 深色外观 · 下载位置（写前自动备份）',
    icon: 'brush'
  },
  {
    path: '/tools',
    label: '系统工具',
    sub: '系统级操作：需要管理员权限，写注册表前先确认',
    icon: 'gear'
  },
  {
    path: '/wallpaper',
    label: '壁纸',
    sub: 'Wallhaven 在线图库 · 点击应用到桌面',
    icon: 'image'
  }
]

export const CATEGORY_ICON: Record<Category, IconName> = {
  devenv: 'terminal',
  daily: 'box',
  proxy: 'globe'
}

export function metaOf(pathname: string): RouteMeta {
  return ROUTES.find((r) => r.path === pathname) ?? ROUTES[0]
}
