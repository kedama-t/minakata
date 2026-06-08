import { useEffect, useState } from 'react'
import { Form, useLocation } from 'react-router'
import type { Theme } from '../lib/theme.ts'
import {
  ActivityIcon,
  ArchiveIcon,
  BookmarkIcon,
  ChatIcon,
  CheckCircleIcon,
  CommandIcon,
  FileTextIcon,
  HomeIcon,
  ListIcon,
  LogOutIcon,
  MenuIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SparkleIcon,
  SunIcon,
  UsersIcon,
  XIcon,
} from './icons.tsx'
import { UserAvatar } from './ui/avatar.tsx'

type NavItem = {
  to: string
  label: string
  icon: (p: { size?: number }) => React.ReactElement
  matchPrefixes?: string[]
  badge?: number
}

type NavGroup = {
  heading: string
  items: NavItem[]
}

/** サイドバー「承認依頼」のバッジ件数 */
export type Approvals = { reviews: number; archives: number }

const MAIN_GROUPS: NavGroup[] = [
  {
    heading: 'メイン',
    items: [
      { to: '/', label: 'ダッシュボード', icon: HomeIcon, matchPrefixes: ['/'] },
      { to: '/search', label: '検索', icon: SearchIcon, matchPrefixes: ['/search'] },
    ],
  },
  {
    heading: 'ナレッジ',
    items: [
      {
        to: '/articles',
        label: '記事一覧',
        icon: FileTextIcon,
        matchPrefixes: ['/articles'],
      },
      { to: '/topics', label: '購読トピック', icon: BookmarkIcon },
    ],
  },
  {
    heading: '対話',
    items: [
      { to: '/chats', label: 'チャット履歴', icon: ChatIcon, matchPrefixes: ['/chats', '/chat/'] },
    ],
  },
  {
    heading: 'エージェント',
    items: [
      { to: '/monitor', label: 'モニター', icon: ActivityIcon },
      { to: '/tasks', label: 'タスク', icon: ListIcon },
    ],
  },
]

/** editor 以上に見せる項目。執筆インサイトはエージェントの自己改善メモリ */
const EDITOR_GROUP: NavGroup = {
  heading: 'フィードバック',
  items: [{ to: '/settings/insights', label: '執筆インサイト', icon: SparkleIcon }],
}

const ADMIN_GROUP: NavGroup = {
  heading: '管理',
  items: [
    { to: '/settings/members', label: 'メンバー', icon: UsersIcon },
    { to: '/settings/policy', label: 'リサーチ方針', icon: SettingsIcon },
    //{ to: '/admin/skills', label: 'スキル', icon: SparkleIcon },
  ],
}

/**
 * 「承認依頼」グループをロールと承認待ち件数から構築する。
 * レビューは editor 以上、アーカイブ承認は admin のみが対象。
 */
function buildApprovalGroup(role: string, approvals: Approvals): NavGroup | null {
  const items: NavItem[] = []
  if (role !== 'viewer') {
    items.push({
      to: '/reviews',
      label: 'レビュー',
      icon: CheckCircleIcon,
      badge: approvals.reviews,
    })
  }
  if (role === 'admin') {
    items.push({
      to: '/admin/archives',
      label: 'アーカイブ承認',
      icon: ArchiveIcon,
      badge: approvals.archives,
    })
  }
  if (items.length === 0) return null
  return { heading: '承認依頼', items }
}

function isActive(currentPath: string, item: NavItem): boolean {
  if (item.to === '/') return currentPath === '/'
  const prefixes = item.matchPrefixes ?? [item.to]
  return prefixes.some((p) => currentPath === p || currentPath.startsWith(`${p}/`))
}

function NavLink({ item, currentPath }: { item: NavItem; currentPath: string }) {
  const active = isActive(currentPath, item)
  const Icon = item.icon
  return (
    <a
      href={item.to}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
        active ? 'bg-primary/10 text-primary font-medium' : 'text-base-content/60 hover:bg-base-200'
      }`}
    >
      <Icon size={16} />
      <span className="flex-1">{item.label}</span>
      {item.badge != null && item.badge > 0 && (
        <span className="badge badge-primary px-2 py-0.5 text-xs min-w-[1.25rem]">
          {item.badge}
        </span>
      )}
    </a>
  )
}

function NavGroupBlock({ group, currentPath }: { group: NavGroup; currentPath: string }) {
  return (
    <div>
      <p className="px-3 mb-1 text-[10px] font-semibold tracking-wider uppercase text-base-content/40">
        {group.heading}
      </p>
      <nav className="flex flex-col gap-0.5">
        {group.items.map((item) => (
          <NavLink key={item.to} item={item} currentPath={currentPath} />
        ))}
      </nav>
    </div>
  )
}

function ThemeToggle({ current }: { current: Theme }) {
  const opts: {
    value: Theme
    icon: (p: { size?: number }) => React.ReactElement
    label: string
  }[] = [
    { value: 'light', icon: SunIcon, label: 'Light' },
    { value: 'system', icon: MonitorIcon, label: 'Auto' },
    { value: 'dark', icon: MoonIcon, label: 'Dark' },
  ]
  return (
    <Form method="post" action="/theme" className="flex items-center p-0.5 bg-base-200 rounded-md">
      {opts.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="submit"
          name="theme"
          value={value}
          title={label}
          aria-label={label}
          className={`flex-1 flex items-center justify-center py-1.5 rounded text-xs transition-colors ${
            current === value
              ? 'bg-surface text-base-content shadow-sm'
              : 'text-base-content/60 hover:text-base-content'
          }`}
        >
          <Icon size={14} />
        </button>
      ))}
    </Form>
  )
}

function UserPanel({
  user,
  theme,
}: {
  user: { email: string; role: string }
  theme: Theme
}) {
  return (
    <div className="flex flex-col gap-2 p-3 border-t border-border">
      <ThemeToggle current={theme} />
      <div className="flex items-center gap-2.5">
        <UserAvatar email={user.email} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-base-content/80 truncate">{user.email}</p>
          <p className="text-[10px] uppercase tracking-wider text-base-content/40">{user.role}</p>
        </div>
        <form method="post" action="/logout">
          <button
            type="submit"
            className="p-1.5 rounded text-base-content/40 hover:text-error hover:bg-error/10 transition-colors"
            title="ログアウト"
            aria-label="ログアウト"
          >
            <LogOutIcon size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}

function SearchTrigger() {
  const openPalette = () => {
    window.dispatchEvent(new CustomEvent('open-command-palette'))
  }
  return (
    <button
      type="button"
      onClick={openPalette}
      className="w-full flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface text-sm text-base-content/60 hover:border-border-strong transition-colors"
    >
      <SearchIcon size={14} />
      <span className="flex-1 text-left">検索…</span>
      <kbd className="flex items-center gap-0.5 text-[10px] text-base-content/40 bg-base-200 px-1.5 py-0.5 rounded font-mono">
        <CommandIcon size={10} />K
      </kbd>
    </button>
  )
}

function NewChatActions({ canEdit }: { canEdit: boolean }) {
  if (!canEdit) return null
  return (
    <a href="/chat/new" className="btn btn-primary btn-sm gap-2 w-full justify-start">
      <PlusIcon size={14} />
      新規チャット
    </a>
  )
}

function SidebarContent({
  user,
  theme,
  currentPath,
  approvals,
}: {
  user: { email: string; role: string }
  theme: Theme
  currentPath: string
  approvals: Approvals
}) {
  const canEdit = user.role !== 'viewer'
  const approvalGroup = buildApprovalGroup(user.role, approvals)
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white">
          <SparkleIcon size={14} />
        </div>
        <span className="font-semibold text-base tracking-tight">Minakata</span>
      </div>
      <div className="px-3 pb-3 space-y-3">
        <SearchTrigger />
        <NewChatActions canEdit={canEdit} />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-5">
        {MAIN_GROUPS.map((g) => (
          <NavGroupBlock key={g.heading} group={g} currentPath={currentPath} />
        ))}
        {approvalGroup && <NavGroupBlock group={approvalGroup} currentPath={currentPath} />}
        {canEdit && <NavGroupBlock group={EDITOR_GROUP} currentPath={currentPath} />}
        {user.role === 'admin' && <NavGroupBlock group={ADMIN_GROUP} currentPath={currentPath} />}
      </div>
      <UserPanel user={user} theme={theme} />
    </div>
  )
}

/**
 * 左サイドバー。デスクトップでは固定表示、モバイルではハンバーガーで開閉する drawer。
 * モバイル時のヘッダー(Logo + ハンバーガー)もここで一緒に提供する。
 */
export function Sidebar({
  user,
  theme,
  approvals,
}: {
  user: { email: string; role: string }
  theme: Theme
  approvals: Approvals
}) {
  const location = useLocation()
  const currentPath = location.pathname
  const [open, setOpen] = useState(false)

  // ルート変更時に drawer を閉じる
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentPath 変化を契機に閉じたい
  useEffect(() => {
    setOpen(false)
  }, [currentPath])

  // body スクロールロック (モバイル drawer 表示中)
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = prev
      }
    }
  }, [open])

  return (
    <>
      {/* モバイル用上部バー */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-2.5 bg-surface border-b border-border">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="p-1.5 rounded hover:bg-base-200"
          aria-label="メニューを開く"
        >
          <MenuIcon size={18} />
        </button>
        <a href="/" className="flex items-center gap-2 flex-1">
          <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary to-secondary flex items-center justify-center text-white">
            <SparkleIcon size={12} />
          </div>
          <span className="font-semibold tracking-tight">Minakata</span>
        </a>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('open-command-palette'))}
          className="p-1.5 rounded hover:bg-base-200"
          aria-label="検索"
        >
          <SearchIcon size={18} />
        </button>
      </header>

      {/* デスクトップ用固定サイドバー */}
      <aside className="hidden lg:flex fixed top-0 left-0 bottom-0 w-64 flex-col bg-surface border-r border-border z-20">
        <SidebarContent user={user} theme={theme} currentPath={currentPath} approvals={approvals} />
      </aside>

      {/* モバイル用 drawer */}
      {open && (
        <>
          <button
            type="button"
            className="lg:hidden fixed inset-0 bg-black/40 z-40"
            onClick={() => setOpen(false)}
            aria-label="メニューを閉じる"
          />
          <aside className="lg:hidden fixed top-0 left-0 bottom-0 w-72 bg-surface border-r border-border z-50 flex flex-col">
            <div className="flex items-center justify-end p-2 border-b border-border">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded hover:bg-base-200"
                aria-label="閉じる"
              >
                <XIcon size={18} />
              </button>
            </div>
            <SidebarContent
              user={user}
              theme={theme}
              currentPath={currentPath}
              approvals={approvals}
            />
          </aside>
        </>
      )}
    </>
  )
}
