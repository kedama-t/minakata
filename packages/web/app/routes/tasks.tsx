import type { TaskRow, TaskStatus } from '@minakata/core'
import { useRouteLoaderData } from 'react-router'
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

  // payload.article_id があるタスクは記事スラッグを引いて遷移できるようにする
  const articleSlugs = new Map<string, string>()
  for (const t of tasks) {
    const aid = typeof t.payload.article_id === 'string' ? t.payload.article_id : null
    if (aid && !articleSlugs.has(aid)) {
      const a = services.articles.read(aid)
      if (a) articleSlugs.set(aid, a.frontmatter.slug)
    }
  }

  const nextCursor = tasks.length === PAGE_SIZE ? tasks[tasks.length - 1]?.created_at : null
  return {
    tasks,
    status: status ?? 'all',
    type: type ?? '',
    showAll,
    isAdmin: user.role === 'admin',
    articleSlugs: Object.fromEntries(articleSlugs),
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

export default function Tasks({ loaderData }: Route.ComponentProps) {
  const { tasks, status, type, showAll, isAdmin, articleSlugs, nextCursor } = loaderData
  const root = useRouteLoaderData<typeof rootLoader>('root')
  const tz = root?.timezone ?? 'Asia/Tokyo'
  // クライアント側のリンク生成では loaderData の URL は分からないので、表示は簡素化
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
      <ul className="space-y-2">
        {tasks.map((t: TaskRow) => {
          const articleId = typeof t.payload.article_id === 'string' ? t.payload.article_id : null
          const slug = articleId ? articleSlugs[articleId] : null
          return (
            <li
              key={t.id}
              className="bg-surface p-3 rounded-lg border transition-colors hover:border-border-strong"
            >
              <div className="flex items-center gap-2 text-xs">
                <span className={`px-2 py-0.5 rounded ${statusBadge(t.status)}`}>
                  {statusLabel(t.status)}
                </span>
                <span className="text-base-content/60">{t.type}</span>
                <span className="text-base-content/40">priority: {t.priority}</span>
                <span className="ml-auto text-base-content/40">
                  {formatDateTime(t.created_at, tz)}
                </span>
              </div>
              <div className="text-sm text-base-content/80 mt-1 flex items-center gap-3">
                <span>
                  経過: {elapsed(t.created_at, t.completed_at)}
                  {t.cost_usd > 0 && (
                    <span className="ml-2 text-base-content/60">${t.cost_usd.toFixed(4)}</span>
                  )}
                  {t.attempts > 0 && t.status !== 'done' && (
                    <span className="ml-2 text-warning">attempts: {t.attempts}</span>
                  )}
                </span>
                {slug && (
                  <a
                    href={`/articles/${slug}`}
                    className="ml-auto text-primary hover:underline text-sm"
                  >
                    記事を開く →
                  </a>
                )}
              </div>
            </li>
          )
        })}
        {tasks.length === 0 && (
          <p className="text-sm text-base-content/60">
            該当するタスクはありません
            {!showAll && '（記事ページから追加調査を依頼するとここに表示されます）'}
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
