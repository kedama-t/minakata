import { getAgentProfile, relativeTime } from '../lib/agent-profiles.ts'
import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/home.ts'

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireUser(request)
  const services = getServices()
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const allRecent = services.articles
    .list({ excludeArchived: true, limit: 100 })
    .filter((a) => a.updated_at >= since)
  const recentUpdates = allRecent.filter((a) => a.source !== 'agent_changelog')
  const newToday = allRecent.filter((a) => a.source === 'agent_research')
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3_600_000).toISOString()
  const changelogs = services.articles
    .list({ limit: 200 })
    .filter((a) => a.source === 'agent_changelog' && a.updated_at >= sevenDaysAgo)
  const recentActivity = services.activity.list({ limit: 8 })
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
  sub,
}: {
  label: string
  value: number | string
  href?: string
  sub?: string
}) {
  const content = (
    <div className="bg-surface border border-border rounded-xl p-4 transition-colors hover:border-border-strong">
      <p className="text-xs font-medium text-base-content/50 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-semibold mt-1.5 tabular-nums">{value}</p>
      {sub && <p className="text-xs text-base-content/40 mt-0.5">{sub}</p>}
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

  const now = new Date()

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-8">
      <header>
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">
          {greeting}、{user.email.split('@')[0]} さん
        </h1>
        <p className="text-sm text-base-content/50 mt-1">直近 24 時間のナレッジ更新です</p>
      </header>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="昨夜の更新" value={recentUpdates.length} sub="件" />
        <StatCard label="新規記事" value={newToday.length} sub="件" />
        <StatCard label="ChangeLog" value={changelogs.length} sub="日報" />
        <StatCard
          label="エージェント活動"
          value={recentActivity.length}
          sub="直近"
          href="/monitor"
        />
      </section>

      {recentActivity.length > 0 && (
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold">エージェント稼働</h2>
            <a href="/monitor" className="text-xs text-primary hover:underline">
              モニターを開く →
            </a>
          </div>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <ul className="divide-y divide-border">
              {recentActivity.map((e) => {
                const profile = getAgentProfile(e.agent_name ?? e.actor)
                return (
                  <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="text-base shrink-0">{profile.emoji}</span>
                    <span className="text-xs font-medium text-base-content/70 shrink-0">
                      {profile.displayName}
                    </span>
                    <span className="text-xs text-base-content/50 truncate">
                      💭 {e.phase}
                      {e.detail ? ` · ${e.detail}` : ''}
                    </span>
                    <span className="text-xs text-base-content/40 ml-auto tabular-nums shrink-0">
                      {relativeTime(e.timestamp, now)}
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      )}

      {changelogs.length > 0 && (
        <section>
          <h2 className="text-base font-semibold mb-3">ChangeLog 日報</h2>
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <ul className="divide-y divide-border">
              {changelogs.map((c) => (
                <li key={c.id} className="px-4 py-3 flex items-center justify-between gap-4">
                  <a
                    href={`/articles/${c.slug}`}
                    className="text-sm text-primary hover:underline truncate"
                  >
                    {c.title}
                  </a>
                  <span className="text-xs text-base-content/40 shrink-0 tabular-nums">
                    {relativeTime(c.updated_at, now)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
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
    status: string
    tags: string[]
    summary: string
    freshness_rank: string
  }[]
  emptyMessage: string
}) {
  if (items.length === 0) return <p className="text-sm text-base-content/50 py-2">{emptyMessage}</p>
  return (
    <ul className="space-y-2">
      {items.map((a) => (
        <li
          key={a.id}
          className="bg-surface border border-border p-4 rounded-xl transition-colors hover:border-border-strong"
        >
          <div className="flex items-start gap-2 flex-wrap">
            <a href={`/articles/${a.slug}`} className="text-primary font-semibold hover:underline">
              {a.title}
            </a>
            <FreshnessBadge rank={a.freshness_rank} />
            {a.status === 'pending_approval' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-warning/20 text-warning font-medium">
                レビュー中
              </span>
            )}
          </div>
          {a.summary && (
            <p className="text-sm text-base-content/60 mt-1.5 line-clamp-2">{a.summary}</p>
          )}
          {a.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2.5">
              {a.tags.map((t) => (
                <a
                  key={t}
                  href={`/articles?tag=${encodeURIComponent(t)}`}
                  className="text-xs bg-base-200 hover:bg-base-300 px-2 py-0.5 rounded-full transition-colors"
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
  return <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>{rank}</span>
}
