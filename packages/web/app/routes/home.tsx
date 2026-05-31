import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/home.ts'

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireUser(request)
  const services = getServices()
  // 直近 24 時間で更新された記事(US-2.3)
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const allRecent = services.articles.list({ limit: 100 }).filter((a) => a.updated_at >= since)
  const recentUpdates = allRecent.filter(
    (a) => a.status === 'published' && a.source !== 'agent_changelog',
  )
  const newToday = allRecent.filter((a) => a.source === 'agent_research')
  // ChangeLog 日報(US-2.4):直近 7 日分
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()
  const changelogs = services.articles
    .list({ limit: 200 })
    .filter((a) => a.source === 'agent_changelog' && a.updated_at >= sevenDaysAgo)
  // 直近のエージェント活動 (#61)
  const recentActivity = services.audit.list({ limit: 10 })
  return {
    recentUpdates,
    newToday,
    changelogs,
    recentActivity,
    user,
  }
}

function StatCard({
  label,
  value,
  href,
}: {
  label: string
  value: number
  href?: string
}) {
  const content = (
    <div className="bg-surface border border-border rounded-lg p-4 transition-colors hover:border-border-strong">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-2xl font-semibold mt-1.5 tabular-nums">{value}</p>
    </div>
  )
  return href ? (
    <a href={href} className="block">
      {content}
    </a>
  ) : (
    content
  )
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { recentUpdates, newToday, changelogs, recentActivity, user } = loaderData
  const greeting = (() => {
    const h = new Date().getHours()
    if (h < 5) return 'こんばんは'
    if (h < 11) return 'おはようございます'
    if (h < 18) return 'こんにちは'
    return 'こんばんは'
  })()
  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-8">
      <header>
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">
          {greeting}、{user.email.split('@')[0]} さん
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          直近 24 時間のナレッジ更新と、エージェントの稼働状況です。
        </p>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="昨夜の更新" value={recentUpdates.length} />
        <StatCard label="新規記事" value={newToday.length} />
        <StatCard label="ChangeLog" value={changelogs.length} />
        <StatCard label="モニター" value={recentActivity.length} href="/monitor" />
      </section>

      {recentActivity.length > 0 && (
        <section className="bg-surface border border-border rounded-lg p-5">
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold">エージェント稼働</h2>
            <a href="/monitor" className="text-xs text-primary hover:underline">
              すべて見る →
            </a>
          </div>
          <ul className="space-y-1 text-sm">
            {recentActivity.map((e) => (
              <li key={e.id} className="flex items-center gap-2 py-1">
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {new Date(e.timestamp).toLocaleTimeString('ja-JP')}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{e.actor}</span>
                <span className="text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                  {e.tool_name}
                </span>
                {e.agent_name && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    via {e.agent_name}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {changelogs.length > 0 && (
        <section className="bg-surface border border-border rounded-lg p-5">
          <h2 className="text-base font-semibold mb-3">ChangeLog 日報</h2>
          <ul className="space-y-1.5 text-sm">
            {changelogs.map((c) => (
              <li key={c.id}>
                <a href={`/articles/${c.slug}`} className="text-primary hover:underline">
                  {c.title}
                </a>
                <span className="text-slate-500 dark:text-slate-400 ml-2 text-xs">
                  {c.updated_at}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="text-base font-semibold mb-3">昨夜の更新</h2>
        <ArticleList items={recentUpdates} emptyMessage="まだ更新がありません" />
      </section>
      <section>
        <h2 className="text-base font-semibold mb-3">新規作成された記事</h2>
        <ArticleList items={newToday} emptyMessage="まだ新規記事がありません" />
      </section>
    </div>
  )
}

function ArticleList({
  items,
  emptyMessage,
}: {
  items: {
    id: string
    slug: string
    title: string
    tags: string[]
    summary: string
    freshness_rank: string
  }[]
  emptyMessage: string
}) {
  if (items.length === 0)
    return <p className="text-sm text-slate-500 dark:text-slate-400">{emptyMessage}</p>
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li
          key={a.id}
          className="bg-surface border border-border p-4 rounded-lg transition-colors hover:border-border-strong"
        >
          <a href={`/articles/${a.slug}`} className="text-primary font-semibold hover:underline">
            {a.title}
          </a>
          <FreshnessBadge rank={a.freshness_rank} />
          {a.summary && (
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-2">
              {a.summary}
            </p>
          )}
          {a.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2.5">
              {a.tags.map((t) => (
                <a
                  key={t}
                  href={`/articles?tag=${encodeURIComponent(t)}`}
                  className="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded transition-colors"
                >
                  {t}
                </a>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function FreshnessBadge({ rank }: { rank: string }) {
  const color =
    rank === 'fresh'
      ? 'bg-success/15 text-success'
      : rank === 'aging'
        ? 'bg-warning/15 text-warning'
        : rank === 'stale'
          ? 'bg-warning/20 text-warning'
          : 'bg-error/15 text-error'
  return <span className={`ml-2 text-xs px-2 py-0.5 rounded ${color}`}>{rank}</span>
}
