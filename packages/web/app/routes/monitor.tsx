import { useEffect, useMemo } from 'react'
import { useRevalidator, useRouteLoaderData, useSearchParams } from 'react-router'
import { Avatar } from '../components/ui/avatar'
import {
  type AgentProfile,
  SYSTEM_PROFILE,
  describeTool,
  getAgentProfile,
  relativeTime,
} from '../lib/agent-profiles.ts'
import { requireUser } from '../lib/auth.ts'
import { formatDateTime } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { loader as rootLoader } from '../root.tsx'
import type { Route } from './+types/monitor.ts'

const PAGE_SIZE = 100
const REFRESH_INTERVAL_MS = 10_000
const ACTIVE_THRESHOLD_MS = 5 * 60_000

export async function loader({ request }: Route.LoaderArgs) {
  requireUser(request)
  const url = new URL(request.url)
  const agent = url.searchParams.get('agent') || undefined
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString()

  const services = getServices()
  const auditRows =
    !agent || agent === SYSTEM_PROFILE.key ? services.audit.list({ limit: PAGE_SIZE, since }) : []
  const activityRows =
    agent === SYSTEM_PROFILE.key
      ? []
      : services.activity.list({ limit: PAGE_SIZE, since, ...(agent ? { actor: agent } : {}) })
  const latestActivityEntries = [...services.activity.latestByActor().entries()].map(
    ([actor, row]) =>
      [
        row.agent_name || actor,
        { phase: row.phase, detail: row.detail, timestamp: row.timestamp },
      ] as const,
  )

  type AuditItem = {
    kind: 'audit'
    id: string
    timestamp: string
    data: (typeof auditRows)[number]
  }
  type ActivityItem = {
    kind: 'activity'
    id: string
    timestamp: string
    data: (typeof activityRows)[number]
  }
  type TimelineItem = AuditItem | ActivityItem

  const timeline: TimelineItem[] = [
    ...auditRows.map(
      (r): AuditItem => ({ kind: 'audit', id: r.id, timestamp: r.timestamp, data: r }),
    ),
    ...activityRows.map(
      (r): ActivityItem => ({ kind: 'activity', id: r.id, timestamp: r.timestamp, data: r }),
    ),
  ]
    .sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1))
    .slice(0, PAGE_SIZE)
  return { timeline, latestActivityEntries }
}

type LoaderData = Route.ComponentProps['loaderData']
type TimelineItem = LoaderData['timeline'][number]

type AgentStat = {
  profile: AgentProfile
  count: number
  lastAt: string
  toolCounts: Map<string, number>
  latestPhase: { phase: string; detail: string | null; at: string } | null
}

function buildAgentStats(
  timeline: TimelineItem[],
  latestActivityEntries: ReadonlyArray<
    readonly [string, { phase: string; detail: string | null; timestamp: string }]
  >,
): AgentStat[] {
  const map = new Map<string, AgentStat>()

  const latestPhaseMap = new Map<string, { phase: string; detail: string | null; at: string }>()
  for (const [actor, row] of latestActivityEntries) {
    latestPhaseMap.set(actor, { phase: row.phase, detail: row.detail, at: row.timestamp })
  }

  for (const item of timeline) {
    if (item.kind === 'audit') {
      const e = item.data
      const key = SYSTEM_PROFILE.key
      const existing = map.get(key)
      if (existing) {
        existing.count += 1
        if (item.timestamp > existing.lastAt) existing.lastAt = item.timestamp
        existing.toolCounts.set(e.tool_name, (existing.toolCounts.get(e.tool_name) ?? 0) + 1)
      } else {
        map.set(key, {
          profile: SYSTEM_PROFILE,
          count: 1,
          lastAt: item.timestamp,
          toolCounts: new Map([[e.tool_name, 1]]),
          latestPhase: null,
        })
      }
    } else {
      const e = item.data
      const key = e.agent_name || e.actor
      if (!map.has(key)) {
        map.set(key, {
          profile: e.agent_name ? getAgentProfile(e.agent_name) : getAgentProfile(e.actor),
          count: 1,
          lastAt: item.timestamp,
          toolCounts: new Map(),
          latestPhase: latestPhaseMap.get(key) ?? null,
        })
      } else {
        const existing = map.get(key)
        if (existing) {
          existing.count += 1
          if (item.timestamp > existing.lastAt) existing.lastAt = item.timestamp
        }
      }
    }
  }

  for (const [actor, phase] of latestPhaseMap) {
    if (!map.has(actor)) {
      map.set(actor, {
        profile: getAgentProfile(actor),
        count: 0,
        lastAt: phase.at,
        toolCounts: new Map(),
        latestPhase: phase,
      })
    }
  }

  return [...map.values()].sort((a, b) => (a.lastAt > b.lastAt ? -1 : 1))
}

function AgentCard({ stat, tz }: { stat: AgentStat; tz: string }) {
  const elapsed = Date.now() - new Date(stat.lastAt).getTime()
  const active = elapsed <= ACTIVE_THRESHOLD_MS
  const favoriteTool = [...stat.toolCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const favoriteAction = favoriteTool ? describeTool(favoriteTool[0]) : null
  return (
    <a
      href={`/monitor?agent=${encodeURIComponent(stat.profile.key)}`}
      className="block bg-surface border border-border rounded-xl p-4 transition-all hover:border-border-strong hover:shadow-sm"
    >
      <div className="flex items-center gap-3">
        <Avatar profile={stat.profile} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <p className="font-semibold text-xl truncate">{stat.profile.displayName}</p>
            {active ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-success/15 text-success shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                稼働中
              </span>
            ) : (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-base-200 text-base-content/50 shrink-0">
                待機
              </span>
            )}
          </div>
          <p className="text-xs text-base-content/50 mt-0.5">{stat.profile.role}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border text-xs">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-base-content/40">最終活動</p>
          <p className="font-medium tabular-nums mt-0.5">
            {relativeTime(stat.lastAt, new Date(), tz)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-base-content/40">件数</p>
          <p className="font-medium tabular-nums mt-0.5">{stat.count} 件</p>
        </div>
      </div>

      {stat.latestPhase ? (
        <p className="text-xs text-base-content/50 mt-2.5 flex items-start gap-1.5">
          <span className="shrink-0">💭</span>
          <span className="line-clamp-2">
            {stat.latestPhase.phase}
            {stat.latestPhase.detail ? ` · ${stat.latestPhase.detail}` : ''}
          </span>
        </p>
      ) : favoriteAction ? (
        <p className="text-xs text-base-content/50 mt-2.5 flex items-center gap-1.5">
          <span>{favoriteAction.icon}</span>
          <span className="truncate">{favoriteAction.phrase}</span>
        </p>
      ) : null}
    </a>
  )
}

function AuditRow({
  event,
  now,
  tz,
}: {
  event: Extract<TimelineItem, { kind: 'audit' }>
  now: Date
  tz: string
}) {
  const e = event.data
  const profile = SYSTEM_PROFILE
  const action = describeTool(e.tool_name)
  const meta = e.metadata ? JSON.stringify(e.metadata, null, 2) : ''
  return (
    <li className="flex gap-3 group py-3 border-b border-border last:border-0">
      <Avatar profile={profile} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-sm">{profile.displayName}</span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded-full ${action.bgClass} ${action.textClass}`}
          >
            {action.icon} {action.phrase}
          </span>
          <span
            className="text-xs text-base-content/40 tabular-nums ml-auto"
            title={formatDateTime(e.timestamp, tz)}
          >
            {relativeTime(e.timestamp, now, tz)}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-base-content/40">
          {e.target_article_id && (
            <span className="font-mono">記事 …{e.target_article_id.slice(-8)}</span>
          )}
          <span className="font-mono">{e.tool_name}</span>
          {e.cost_usd > 0 && <span className="tabular-nums ml-auto">${e.cost_usd.toFixed(4)}</span>}
        </div>
        {meta && (
          <details className="text-xs mt-1.5">
            <summary className="cursor-pointer text-base-content/40 hover:text-base-content/70 select-none">
              詳細
            </summary>
            <pre className="mt-1.5 p-2 bg-base-200 border border-border rounded text-[11px] overflow-x-auto">
              {meta}
            </pre>
          </details>
        )}
      </div>
    </li>
  )
}

function ActivityRow({
  item,
  now,
  tz,
}: {
  item: Extract<TimelineItem, { kind: 'activity' }>
  now: Date
  tz: string
}) {
  const e = item.data
  const profile = e.agent_name ? getAgentProfile(e.agent_name) : getAgentProfile(e.actor)
  return (
    <li className="flex gap-3 group py-3 border-b border-border last:border-0">
      <Avatar profile={profile} size="sm" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-sm">{profile.displayName}</span>
          <span className="text-xs px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
            💭 {e.phase}
          </span>
          <span
            className="text-xs text-base-content/40 tabular-nums ml-auto"
            title={formatDateTime(e.timestamp, tz)}
          >
            {relativeTime(e.timestamp, now, tz)}
          </span>
        </div>
        {e.detail && <p className="mt-0.5 text-xs text-base-content/50 truncate">{e.detail}</p>}
        {e.target_article_id && (
          <p className="mt-0.5 text-xs text-base-content/40 font-mono">
            記事 …{e.target_article_id.slice(-8)}
          </p>
        )}
      </div>
    </li>
  )
}

export default function Monitor({ loaderData }: Route.ComponentProps) {
  const { timeline, latestActivityEntries } = loaderData
  const root = useRouteLoaderData<typeof rootLoader>('root')
  const tz = root?.timezone ?? 'Asia/Tokyo'
  const revalidator = useRevalidator()
  const [searchParams] = useSearchParams()
  const activeAgent = searchParams.get('agent')
  useEffect(() => {
    const id = setInterval(() => {
      if (revalidator.state === 'idle') revalidator.revalidate()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [revalidator])

  const stats = useMemo(
    () => buildAgentStats(timeline, latestActivityEntries),
    [timeline, latestActivityEntries],
  )
  const now = useMemo(() => new Date(), [])
  const activeCount = stats.filter(
    (s) => Date.now() - new Date(s.lastAt).getTime() <= ACTIVE_THRESHOLD_MS,
  ).length

  return (
    <div className="max-w-5xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {activeAgent && (
            <a
              href="/monitor"
              className="inline-flex items-center gap-1 text-sm text-base-content/50 hover:text-base-content mb-2"
            >
              ← 全エージェント
            </a>
          )}
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">エージェントの様子</h1>
          <p className="text-sm text-base-content/50 mt-1 flex items-center gap-2 flex-wrap">
            <span>直近 24 時間 · {timeline.length} 件</span>
            {activeCount > 0 && (
              <span className="inline-flex items-center gap-1 text-success">
                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
                {activeCount} 名稼働中
              </span>
            )}
            <span className="text-base-content/30">
              {revalidator.state === 'idle' ? '自動更新中' : '更新中…'}
            </span>
          </p>
        </div>
      </header>

      {!activeAgent && stats.length > 0 && (
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {stats.map((s) => (
            <AgentCard key={s.profile.key} stat={s} tz={tz} />
          ))}
        </section>
      )}

      {/* タイムライン */}
      <section>
        <h2 className="text-base font-semibold mb-3">タイムライン</h2>
        {timeline.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-10 text-center">
            <p className="text-3xl mb-3">😴</p>
            <p className="text-sm text-base-content/50">
              この期間にエージェントの活動はありませんでした
            </p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-xl px-4">
            <ul>
              {timeline.map((item) =>
                item.kind === 'audit' ? (
                  <AuditRow key={item.id} event={item} now={now} tz={tz} />
                ) : (
                  <ActivityRow key={item.id} item={item} now={now} tz={tz} />
                ),
              )}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
