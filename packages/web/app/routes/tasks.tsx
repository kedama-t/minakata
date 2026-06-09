import type { TaskPriority, TaskRow, TaskStatus } from '@minakata/core'
import BoringAvatar from 'boring-avatars'
import { useState } from 'react'
import { useRouteLoaderData } from 'react-router'
import { getAgentProfile } from '../lib/agent-profiles.ts'
import { articleHref } from '../lib/article-link.ts'
import { requireEditor } from '../lib/auth.ts'
import { formatDateTime } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { loader as rootLoader } from '../root.tsx'
import type { Route } from './+types/tasks.ts'

const PAGE_SIZE = 50
const VALID_STATUSES: TaskStatus[] = ['queued', 'claimed', 'done', 'failed']

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireEditor(request)
  const url = new URL(request.url)
  const statusParam = url.searchParams.get('status')
  const status = VALID_STATUSES.includes(statusParam as TaskStatus)
    ? (statusParam as TaskStatus)
    : undefined
  const typeParam = url.searchParams.get('type')
  const type = typeParam || undefined
  const before = url.searchParams.get('before') ?? undefined
  const showAll = user.role === 'admin' && url.searchParams.get('all') === 'true'

  const services = getServices()
  const tasks = showAll
    ? services.tasks.listAll({ status, type, limit: PAGE_SIZE, before })
    : services.tasks.listByUser({
        user_id: user.id,
        status,
        type,
        limit: PAGE_SIZE,
        before,
      })

  // 「何を・どこから依頼したか」を出すために、依頼者・依頼元チャット・対象記事を引く
  const requesters = new Map<string, string>()
  const sessions = new Map<string, string>()
  const articles = new Map<string, { slug: string; title: string }>()
  for (const t of tasks) {
    if (t.requested_by && !requesters.has(t.requested_by)) {
      const u = services.auth.findUserById(t.requested_by)
      if (u) requesters.set(t.requested_by, u.email)
    }
    if (t.session_id && !sessions.has(t.session_id)) {
      const sess = services.messages.getSession(t.session_id)
      if (sess) sessions.set(t.session_id, sess.title)
    }
    const aid = typeof t.payload.article_id === 'string' ? t.payload.article_id : null
    if (aid && !articles.has(aid)) {
      const a = services.articles.read(aid)
      if (a) articles.set(aid, { slug: a.frontmatter.slug, title: a.frontmatter.title })
    }
  }

  const nextCursor = tasks.length === PAGE_SIZE ? tasks[tasks.length - 1]?.created_at : null
  return {
    tasks,
    status: status ?? 'all',
    type: type ?? '',
    showAll,
    isAdmin: user.role === 'admin',
    requesters: Object.fromEntries(requesters),
    sessions: Object.fromEntries(sessions),
    articles: Object.fromEntries(articles),
    nextCursor,
  }
}

function statusBadge(status: TaskStatus): string {
  switch (status) {
    case 'queued':
      return 'bg-base-200 text-base-content/80'
    case 'claimed':
      return 'bg-primary/15 text-primary'
    case 'done':
      return 'bg-success/15 text-success'
    case 'failed':
      return 'bg-error/15 text-error'
  }
}

function statusLabel(status: TaskStatus): string {
  switch (status) {
    case 'queued':
      return '待機中'
    case 'claimed':
      return '実行中'
    case 'done':
      return '完了'
    case 'failed':
      return '失敗'
  }
}

/** type ごとのアイコン・ラベル・色味(カードの先頭アイコンに使う) */
function typeMeta(type: string): { icon: string; label: string; tint: string } {
  switch (type) {
    case 'research':
      return { icon: '🔎', label: '調査', tint: 'bg-sky-500/15 text-sky-600' }
    case 'refresh':
      return { icon: '🔄', label: '鮮度更新', tint: 'bg-emerald-500/15 text-emerald-600' }
    case 'daily_research':
      return { icon: '🌅', label: '日次調査', tint: 'bg-amber-500/15 text-amber-600' }
    case 'research_followup':
      return { icon: '💬', label: '追加調査', tint: 'bg-fuchsia-500/15 text-fuchsia-600' }
    default:
      return { icon: '📋', label: type, tint: 'bg-base-200 text-base-content/70' }
  }
}

function priorityMeta(p: TaskPriority): { label: string; dot: string } {
  switch (p) {
    case 'urgent':
      return { label: '緊急', dot: 'bg-error' }
    case 'interactive':
      return { label: '対話', dot: 'bg-primary' }
    case 'scheduled':
      return { label: '定期', dot: 'bg-success' }
    case 'maintenance':
      return { label: '保守', dot: 'bg-base-content/40' }
  }
}

/** payload から「何を依頼したか」を人間可読なタイトルに落とす */
function taskTitle(t: TaskRow): string {
  const p = t.payload
  const pick = (k: string): string | null =>
    typeof p[k] === 'string' && p[k] ? (p[k] as string) : null
  const goal = pick('goal') ?? pick('query') ?? pick('comment')
  if (goal) return goal
  if (pick('reason') === 'unarchived') return 'アーカイブ復帰にともなう再調査'
  return typeMeta(t.type).label
}

function tabClass(active: boolean): string {
  return active
    ? 'px-3 py-1 rounded-t border-b-2 border-primary text-primary font-medium'
    : 'px-3 py-1 text-base-content/60 hover:text-primary'
}

function elapsed(from: string, to: string | null): string {
  const start = Date.parse(from)
  const end = to ? Date.parse(to) : Date.now()
  const sec = Math.max(0, Math.floor((end - start) / 1000))
  if (sec < 60) return `${sec}秒`
  if (sec < 3600) return `${Math.floor(sec / 60)}分`
  if (sec < 86400) return `${Math.floor(sec / 3600)}時間`
  return `${Math.floor(sec / 86400)}日`
}

/** 行内に置く小さなユーザーアバター */
function MiniUserAvatar({ email }: { email: string }) {
  return (
    <span className="w-5 h-5 rounded-full overflow-hidden shrink-0 ring-1 ring-base-300">
      <BoringAvatar size={20} name={email} variant="beam" />
    </span>
  )
}

/** 行内に置く小さなエージェントアバター(画像失敗時は絵文字) */
function MiniAgentAvatar({ name }: { name: string }) {
  const profile = getAgentProfile(name)
  const [failed, setFailed] = useState(false)
  return (
    <span
      className={`w-5 h-5 rounded-full overflow-hidden shrink-0 ring-1 ${profile.ring ?? 'ring-base-300'} bg-base-200 flex items-center justify-center text-[10px]`}
      title={profile.displayName}
    >
      {profile.avatar && !failed ? (
        <img
          src={profile.avatar}
          alt={profile.displayName}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span>{profile.emoji}</span>
      )}
    </span>
  )
}

/** 「どこから依頼したか」を表すバッジ(チャット / 記事 / 自動 への導線) */
function SourceBadge({
  task,
  sessionTitle,
  article,
}: {
  task: TaskRow
  sessionTitle: string | null
  article: { slug: string; title: string } | null
}) {
  if (task.session_id) {
    return (
      <a
        href={`/chat/${task.session_id}`}
        className="inline-flex items-center gap-1 text-primary hover:underline max-w-[20rem] truncate"
      >
        <span>💬</span>
        <span className="truncate">{sessionTitle || 'チャット'}</span>
      </a>
    )
  }
  if (article) {
    return (
      <a
        href={articleHref(article.slug)}
        className="inline-flex items-center gap-1 text-primary hover:underline max-w-[20rem] truncate"
      >
        <span>📄</span>
        <span className="truncate">{article.title}</span>
      </a>
    )
  }
  if (task.type === 'daily_research') {
    return (
      <span className="inline-flex items-center gap-1 text-base-content/60">🌅 自動(日次調査)</span>
    )
  }
  return <span className="inline-flex items-center gap-1 text-base-content/60">⚙️ システム</span>
}

export default function Tasks({ loaderData }: Route.ComponentProps) {
  const { tasks, status, type, showAll, isAdmin, requesters, sessions, articles, nextCursor } =
    loaderData
  const root = useRouteLoaderData<typeof rootLoader>('root')
  const tz = root?.timezone ?? 'Asia/Tokyo'
  return (
    <div className="max-w-5xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">タスク履歴</h1>
      <div className="flex gap-2 mb-4 border-b">
        <a
          className={tabClass(status === 'all')}
          href={`/tasks${showAll ? '?all=true' : ''}${type ? `${showAll ? '&' : '?'}type=${encodeURIComponent(type)}` : ''}`}
        >
          すべて
        </a>
        {VALID_STATUSES.map((st) => {
          const params = new URLSearchParams()
          params.set('status', st)
          if (type) params.set('type', type)
          if (showAll) params.set('all', 'true')
          return (
            <a key={st} className={tabClass(status === st)} href={`/tasks?${params.toString()}`}>
              {statusLabel(st)}
            </a>
          )
        })}
        <div className="ml-auto flex items-center gap-3">
          {isAdmin && (
            <a
              className="text-sm text-primary hover:underline"
              href={
                showAll
                  ? `/tasks${status !== 'all' ? `?status=${status}` : ''}`
                  : `/tasks?all=true${status !== 'all' ? `&status=${status}` : ''}`
              }
            >
              {showAll ? '自分の依頼のみ' : '全ユーザーのタスク'}
            </a>
          )}
        </div>
      </div>
      <ul className="space-y-3">
        {tasks.map((t: TaskRow) => {
          const tm = typeMeta(t.type)
          const pm = priorityMeta(t.priority)
          const articleId = typeof t.payload.article_id === 'string' ? t.payload.article_id : null
          const article = articleId ? (articles[articleId] ?? null) : null
          const sessionTitle = t.session_id ? (sessions[t.session_id] ?? null) : null
          const requesterEmail = t.requested_by ? (requesters[t.requested_by] ?? null) : null
          return (
            <li
              key={t.id}
              className="bg-surface rounded-xl border transition-colors hover:border-border-strong"
            >
              <div className="flex items-start gap-3 p-4">
                <div
                  className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0 ${tm.tint}`}
                >
                  {tm.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs mb-1">
                    <span className={`px-2 py-0.5 rounded ${statusBadge(t.status)}`}>
                      {statusLabel(t.status)}
                    </span>
                    <span className="text-base-content/60">{tm.label}</span>
                    <span className="inline-flex items-center gap-1 text-base-content/50">
                      <span className={`w-1.5 h-1.5 rounded-full ${pm.dot}`} />
                      {pm.label}
                    </span>
                    <span className="ml-auto text-base-content/40">
                      {formatDateTime(t.created_at, tz)}
                    </span>
                  </div>
                  <p className="font-medium text-base-content line-clamp-2">{taskTitle(t)}</p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-base-content/70">
                    <span className="inline-flex items-center gap-1">
                      <span className="text-base-content/40">依頼元</span>
                      <SourceBadge task={t} sessionTitle={sessionTitle} article={article} />
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span className="text-base-content/40">依頼者</span>
                      {requesterEmail ? (
                        <>
                          <MiniUserAvatar email={requesterEmail} />
                          <span className="truncate max-w-[12rem]">{requesterEmail}</span>
                        </>
                      ) : (
                        <span className="text-base-content/50">自動</span>
                      )}
                    </span>
                    {t.claimed_by && (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-base-content/40">担当</span>
                        <MiniAgentAvatar name={t.claimed_by} />
                        <span>{getAgentProfile(t.claimed_by).displayName}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-base-content/50">
                    <span>経過 {elapsed(t.created_at, t.completed_at)}</span>
                    {t.cost_usd > 0 && <span>${t.cost_usd.toFixed(4)}</span>}
                    {t.attempts > 0 && t.status !== 'done' && (
                      <span className="text-warning">再試行 {t.attempts}</span>
                    )}
                    {article && (
                      <a
                        href={articleHref(article.slug)}
                        className="ml-auto text-primary hover:underline"
                      >
                        記事を開く →
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        })}
        {tasks.length === 0 && (
          <p className="text-sm text-base-content/60">
            該当するタスクはありません
            {!showAll && '(記事ページから追加調査を依頼するとここに表示されます)'}
          </p>
        )}
      </ul>
      {nextCursor && (
        <div className="mt-4">
          <a
            href={(() => {
              const params = new URLSearchParams()
              if (status !== 'all') params.set('status', status)
              if (type) params.set('type', type)
              if (showAll) params.set('all', 'true')
              params.set('before', nextCursor)
              return `/tasks?${params.toString()}`
            })()}
            className="text-sm text-primary hover:underline"
          >
            さらに読み込む
          </a>
        </div>
      )}
    </div>
  )
}
