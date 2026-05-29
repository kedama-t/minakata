import type { TaskRow, TaskStatus } from '@minakata/core'
import { requireEditor } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
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
      return 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
    case 'claimed':
      return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
    case 'done':
      return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
    case 'failed':
      return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300'
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
    ? 'px-3 py-1 rounded-t border-b-2 border-blue-600 text-blue-700 dark:text-blue-300 font-medium'
    : 'px-3 py-1 text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400'
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
              className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
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
                <span className="text-slate-500 dark:text-slate-400">{t.type}</span>
                <span className="text-slate-400 dark:text-slate-500">priority: {t.priority}</span>
                <span className="ml-auto text-slate-400 dark:text-slate-500">
                  {new Date(t.created_at).toLocaleString('ja-JP')}
                </span>
              </div>
              <div className="text-sm text-slate-700 dark:text-slate-200 mt-1 flex items-center gap-3">
                <span>
                  経過: {elapsed(t.created_at, t.completed_at)}
                  {t.cost_usd > 0 && (
                    <span className="ml-2 text-slate-500 dark:text-slate-400">
                      ${t.cost_usd.toFixed(4)}
                    </span>
                  )}
                  {t.attempts > 0 && t.status !== 'done' && (
                    <span className="ml-2 text-orange-600 dark:text-orange-400">
                      attempts: {t.attempts}
                    </span>
                  )}
                </span>
                {slug && (
                  <a
                    href={`/articles/${slug}`}
                    className="ml-auto text-blue-600 dark:text-blue-400 hover:underline text-sm"
                  >
                    記事を開く →
                  </a>
                )}
              </div>
            </li>
          )
        })}
        {tasks.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
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
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
          >
            さらに読み込む
          </a>
        </div>
      )}
    </div>
  )
}
