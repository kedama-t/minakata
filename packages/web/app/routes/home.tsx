import type { HeatmapDay, HeatmapHour } from '../components/maintenance-heatmap.tsx'
import { MaintenanceHeatmap } from '../components/maintenance-heatmap.tsx'
import { FreshnessBadge } from '../components/ui/freshness-badge.tsx'
import { useDict } from '../i18n/index.ts'
import { getAgentProfile, relativeTime } from '../lib/agent-profiles.ts'
import { articleHref } from '../lib/article-link.ts'
import { requireUser } from '../lib/auth.ts'
import { dayAndHour, localHour, useTimezone } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/home.ts'

const HEATMAP_DAYS = 14

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireUser(request)
  const services = getServices()

  // アクションサマリー用件数
  const pendingReviews = user.role !== 'viewer' ? services.reviews.listPending().length : 0
  const activeTasks =
    user.role !== 'viewer'
      ? services.tasks.listAll({ status: 'queued' }).length +
        services.tasks.listAll({ status: 'claimed' }).length
      : 0

  const allArticles = services.articles.list({ excludeArchived: true, limit: 2000 })
  const staleCount = allArticles.filter(
    (a) => a.freshness_rank === 'stale' || a.freshness_rank === 'very_stale',
  ).length

  const since24h = new Date(Date.now() - 24 * 3_600_000).toISOString()
  const recentCount = allArticles.filter(
    (a) => a.updated_at >= since24h && a.source !== 'agent_changelog',
  ).length

  // ヒートマップ用: 過去 HEATMAP_DAYS 日の記事操作イベント(tz変換はブラウザではなくサーバーで実施)
  const sinceHeatmap = new Date(Date.now() - HEATMAP_DAYS * 24 * 3_600_000).toISOString()
  const maintenanceEvents = services.audit.maintenanceEvents({ since: sinceHeatmap })

  // 最近の動き
  const recentActivity = services.activity.list({ limit: 5 })
  const recentArticles = allArticles
    .filter((a) => a.source !== 'agent_changelog')
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .slice(0, 5)

  return {
    user,
    pendingReviews,
    activeTasks,
    staleCount,
    recentCount,
    maintenanceEvents,
    recentActivity,
    recentArticles,
  }
}

/** イベント配列をヒートマップ用の日×時間バケツに変換する */
function buildHeatmapDays(
  events: { timestamp: string; tool_name: string }[],
  tz: string,
  numDays: number,
): HeatmapDay[] {
  // 過去 numDays 日分の日付文字列を生成(新しい日が末尾)
  const dayKeys: string[] = []
  for (let i = numDays - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3_600_000)
    const { day } = dayAndHour(d.toISOString(), tz)
    if (!dayKeys.includes(day)) dayKeys.push(day)
  }

  const map = new Map<string, HeatmapHour[]>()
  for (const key of dayKeys) {
    map.set(
      key,
      Array.from({ length: 24 }, (_, h) => ({ hour: h, total: 0, created: 0, updated: 0 })),
    )
  }

  for (const ev of events) {
    const { day, hour } = dayAndHour(ev.timestamp, tz)
    const hours = map.get(day)
    if (!hours) continue
    const cell = hours[hour]
    if (!cell) continue
    cell.total++
    if (ev.tool_name === 'minakata.create_article') cell.created++
    else cell.updated++
  }

  return dayKeys.map((day) => ({ day, hours: map.get(day) ?? [] }))
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const {
    user,
    pendingReviews,
    activeTasks,
    staleCount,
    recentCount,
    maintenanceEvents,
    recentActivity,
    recentArticles,
  } = loaderData

  const tz = useTimezone()
  const t = useDict()

  const greeting = (() => {
    const h = localHour(tz)
    if (h < 5) return t.home.greetingEvening
    if (h < 11) return t.home.greetingMorning
    if (h < 18) return t.home.greetingAfternoon
    return t.home.greetingEvening
  })()

  const now = new Date()
  const heatmapDays = buildHeatmapDays(maintenanceEvents, tz, HEATMAP_DAYS)

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-8">
      {/* ヘッダー */}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">
            {t.home.greetingTo(greeting, user.email.split('@')[0] ?? '')}
          </h1>
          <p className="text-sm text-base-content/50 mt-1">{t.home.subtitle}</p>
        </div>
        {user.role !== 'viewer' && (
          <a href="/chat/new" className="btn btn-primary btn-sm gap-1.5 shrink-0">
            {t.home.newChat}
          </a>
        )}
      </header>

      {/* 承認待ち CTA バナー */}
      {pendingReviews > 0 && user.role !== 'viewer' && (
        <a
          href="/reviews"
          className="flex items-center justify-between gap-4 bg-warning/10 border border-warning/30 rounded-xl px-4 py-3 hover:bg-warning/15 transition-colors"
        >
          <span className="text-sm font-medium text-warning">
            {t.home.pendingBanner(pendingReviews)}
          </span>
          <span className="text-xs text-warning/70 shrink-0">{t.home.pendingBannerCta}</span>
        </a>
      )}

      {/* アクションサマリー */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {user.role !== 'viewer' && (
          <ActionCard
            label={t.home.cardPendingReviews}
            value={pendingReviews}
            sub={t.common.countUnit}
            href="/reviews"
            highlight={pendingReviews > 0}
          />
        )}
        {user.role !== 'viewer' && (
          <ActionCard
            label={t.home.cardActiveTasks}
            value={activeTasks}
            sub={t.common.countUnit}
            href="/tasks"
          />
        )}
        <ActionCard
          label={t.home.cardStaleArticles}
          value={staleCount}
          sub={t.common.countUnit}
          href="/articles"
          highlight={staleCount > 0}
        />
        <ActionCard
          label={t.home.cardRecentUpdates}
          value={recentCount}
          sub={t.common.countUnit}
          href="/articles"
        />
      </section>

      {/* メンテナンスヒートマップ */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="text-base font-semibold">{t.home.maintenanceTitle}</h2>
          <span className="text-xs text-base-content/40">
            {t.home.maintenanceRange(HEATMAP_DAYS)}
          </span>
        </div>
        <div className="bg-surface border border-border rounded-xl p-4">
          <MaintenanceHeatmap days={heatmapDays} timezone={tz} />
        </div>
      </section>

      {/* 最近の動き */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* エージェント稼働 */}
        {recentActivity.length > 0 && (
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-base font-semibold">{t.home.agentActivityTitle}</h2>
              <a href="/monitor" className="text-xs text-primary hover:underline">
                {t.home.openMonitor}
              </a>
            </div>
            <div className="bg-surface border border-border rounded-xl overflow-hidden">
              <ul className="divide-y divide-border">
                {recentActivity.map((e) => {
                  const profile = getAgentProfile(e.agent_name ?? e.actor, t)
                  return (
                    <li key={e.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="text-base shrink-0">{profile.emoji}</span>
                      <span className="text-xs font-medium text-base-content/70 shrink-0 truncate max-w-24">
                        {profile.displayName}
                      </span>
                      <span className="text-xs text-base-content/50 truncate">
                        {e.phase}
                        {e.detail ? ` · ${e.detail}` : ''}
                      </span>
                      <span className="text-xs text-base-content/40 ml-auto tabular-nums shrink-0">
                        {relativeTime(e.timestamp, t, now, tz)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}

        {/* 最近更新された記事 */}
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-base font-semibold">{t.home.recentArticlesTitle}</h2>
            <a href="/articles" className="text-xs text-primary hover:underline">
              {t.home.viewAll}
            </a>
          </div>
          {recentArticles.length === 0 ? (
            <p className="text-sm text-base-content/50 py-2">{t.home.noArticles}</p>
          ) : (
            <ul className="space-y-2">
              {recentArticles.map((a) => (
                <li
                  key={a.id}
                  className="bg-surface border border-border p-3 rounded-xl hover:border-border-strong transition-colors"
                >
                  <div className="flex items-start gap-2 flex-wrap">
                    <a
                      href={articleHref(a.slug)}
                      className="text-sm text-primary font-medium hover:underline"
                    >
                      {a.title}
                    </a>
                    <FreshnessBadge rank={a.freshness_rank} />
                    {a.status === 'pending_approval' && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-warning/20 text-warning font-medium">
                        {t.common.inReview}
                      </span>
                    )}
                  </div>
                  {a.summary && (
                    <p className="text-xs text-base-content/50 mt-1 line-clamp-1">{a.summary}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  )
}

function ActionCard({
  label,
  value,
  sub,
  href,
  highlight,
}: {
  label: string
  value: number
  sub?: string
  href: string
  highlight?: boolean
}) {
  return (
    <a href={href} className="block">
      <div
        className={`bg-surface border rounded-xl p-4 transition-colors hover:border-border-strong ${
          highlight ? 'border-warning/40' : 'border-border'
        }`}
      >
        <p className="text-xs font-medium text-base-content/50 uppercase tracking-wider">{label}</p>
        <p
          className={`text-2xl font-semibold mt-1.5 tabular-nums ${highlight ? 'text-warning' : ''}`}
        >
          {value}
        </p>
        {sub && <p className="text-xs text-base-content/40 mt-0.5">{sub}</p>}
      </div>
    </a>
  )
}
