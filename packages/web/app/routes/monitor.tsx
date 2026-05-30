import { useEffect, useMemo } from 'react'
import { Form, useRevalidator } from 'react-router'
import {
  type AgentProfile,
  describeTool,
  getActorProfile,
  getAgentProfile,
  relativeTime,
} from '../lib/agent-profiles.ts'
import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/monitor.ts'

const PAGE_SIZE = 100
const REFRESH_INTERVAL_MS = 10_000
const ACTIVE_THRESHOLD_MS = 5 * 60_000

export async function loader({ request }: Route.LoaderArgs) {
  requireUser(request)
  const url = new URL(request.url)
  const agent = url.searchParams.get('agent') || undefined
  const tool = url.searchParams.get('tool') || undefined
  const hoursParam = url.searchParams.get('hours')
  const hours = hoursParam ? Math.max(1, Math.min(720, Number(hoursParam) || 24)) : 24
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()

  const services = getServices()
  const auditRows = services.audit.list({
    limit: PAGE_SIZE,
    since,
    agent_name: agent,
    tool_name: tool,
  })
  // ツール絞り込み時は実況を除外(audit ツール検索の邪魔にならないように)
  const activityRows = tool
    ? []
    : services.activity.list({ limit: PAGE_SIZE, since, ...(agent ? { actor: agent } : {}) })
  const latestActivityEntries = [...services.activity.latestByActor().entries()].map(
    ([actor, row]) =>
      [actor, { phase: row.phase, detail: row.detail, timestamp: row.timestamp }] as const,
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

  const agents = services.audit.distinctAgents()
  const tools = services.audit.distinctTools()
  return {
    timeline,
    agents,
    tools,
    agent: agent ?? '',
    tool: tool ?? '',
    hours,
    latestActivityEntries,
  }
}

function Avatar({
  profile,
  size = 'md',
}: {
  profile: AgentProfile
  size?: 'sm' | 'md' | 'lg'
}) {
  const dim =
    size === 'lg' ? 'w-14 h-14 text-2xl' : size === 'sm' ? 'w-7 h-7 text-sm' : 'w-10 h-10 text-lg'
  return (
    <div
      className={`${dim} rounded-full bg-gradient-to-br ${profile.gradient} flex items-center justify-center shadow-sm flex-shrink-0 ring-2 ring-white dark:ring-slate-900`}
      title={profile.displayName}
      aria-label={profile.displayName}
    >
      <img
        src={profile.avatar}
        alt={profile.displayName}
        className="w-full h-full rounded-full object-cover"
        onError={(e) => {
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
        }}
      />
      {!profile.avatar && <span>{profile.emoji}</span>}
    </div>
  )
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
      const key = e.agent_name || e.actor
      const existing = map.get(key)
      if (existing) {
        existing.count += 1
        if (item.timestamp > existing.lastAt) existing.lastAt = item.timestamp
        existing.toolCounts.set(e.tool_name, (existing.toolCounts.get(e.tool_name) ?? 0) + 1)
      } else {
        const profile = e.agent_name
          ? getAgentProfile(e.agent_name)
          : getActorProfile(e.actor, e.agent_name)
        map.set(key, {
          profile,
          count: 1,
          lastAt: item.timestamp,
          toolCounts: new Map([[e.tool_name, 1]]),
          latestPhase: latestPhaseMap.get(key) ?? null,
        })
      }
    } else {
      const e = item.data
      const key = e.actor
      if (!map.has(key)) {
        map.set(key, {
          profile: getAgentProfile(e.actor),
          count: 0,
          lastAt: item.timestamp,
          toolCounts: new Map(),
          latestPhase: latestPhaseMap.get(key) ?? null,
        })
      } else {
        const existing = map.get(key)
        if (existing && item.timestamp > existing.lastAt) existing.lastAt = item.timestamp
      }
    }
  }

  // latestPhase だけあって timeline に出ていない actor も補完
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

function AgentCard({ stat }: { stat: AgentStat }) {
  const elapsed = Date.now() - new Date(stat.lastAt).getTime()
  const active = elapsed <= ACTIVE_THRESHOLD_MS
  const favoriteTool = [...stat.toolCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const favoriteAction = favoriteTool ? describeTool(favoriteTool[0]) : null
  return (
    <a
      href={`/monitor?agent=${encodeURIComponent(stat.profile.key)}`}
      className="block bg-surface border border-border rounded-xl p-4 transition-all hover:border-border-strong hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <Avatar profile={stat.profile} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="font-semibold truncate">{stat.profile.displayName}</p>
            {active ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                稼働中
              </span>
            ) : (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                待機中
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-1">
            {stat.profile.role}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-border">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            最終活動
          </p>
          <p className="text-sm font-medium tabular-nums mt-0.5">{relativeTime(stat.lastAt)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
            活動件数
          </p>
          <p className="text-sm font-medium tabular-nums mt-0.5">{stat.count} 件</p>
        </div>
      </div>
      {/* 最新の実況を優先表示。なければ最頻ツールにフォールバック */}
      {stat.latestPhase ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1.5 truncate">
          <span>💭</span>
          <span className="truncate">
            {stat.latestPhase.phase}
            {stat.latestPhase.detail ? ` · ${stat.latestPhase.detail}` : ''}
          </span>
        </p>
      ) : favoriteAction ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-1.5">
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
}: {
  event: Extract<TimelineItem, { kind: 'audit' }>
  now: Date
}) {
  const e = event.data
  const profile = e.agent_name
    ? getAgentProfile(e.agent_name)
    : getActorProfile(e.actor, e.agent_name)
  const action = describeTool(e.tool_name)
  const meta = e.metadata ? JSON.stringify(e.metadata, null, 2) : ''
  return (
    <li className="flex gap-3 group">
      <div className="flex flex-col items-center pt-1 flex-shrink-0">
        <Avatar profile={profile} size="md" />
        <div className="flex-1 w-px bg-slate-200 dark:bg-slate-800 my-1 group-last:hidden" />
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-sm">{profile.displayName}</span>
          <span className={`text-xs px-1.5 py-0.5 rounded ${action.bgClass} ${action.textClass}`}>
            {action.icon} {action.phrase}
          </span>
          <span
            className="text-xs text-slate-400 dark:text-slate-500 tabular-nums"
            title={new Date(e.timestamp).toLocaleString('ja-JP')}
          >
            {relativeTime(e.timestamp, now)}
          </span>
          {e.cost_usd > 0 && (
            <span className="text-xs text-slate-400 dark:text-slate-500 tabular-nums ml-auto">
              ${e.cost_usd.toFixed(4)}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
          {e.target_article_id && (
            <span className="font-mono">記事 …{e.target_article_id.slice(-8)}</span>
          )}
          <span className="font-mono opacity-60">{e.tool_name}</span>
        </div>
        {meta && (
          <details className="text-xs mt-1.5">
            <summary className="cursor-pointer text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 select-none">
              詳細を見る
            </summary>
            <pre className="mt-1.5 p-2 bg-canvas/50 border border-border rounded text-[11px] overflow-x-auto">
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
}: {
  item: Extract<TimelineItem, { kind: 'activity' }>
  now: Date
}) {
  const e = item.data
  const profile = getAgentProfile(e.actor)
  return (
    <li className="flex gap-3 group">
      <div className="flex flex-col items-center pt-1 flex-shrink-0">
        <Avatar profile={profile} size="md" />
        <div className="flex-1 w-px bg-slate-200 dark:bg-slate-800 my-1 group-last:hidden" />
      </div>
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-medium text-sm">{profile.displayName}</span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-300">
            💭 {e.phase}
          </span>
          <span
            className="text-xs text-slate-400 dark:text-slate-500 tabular-nums"
            title={new Date(e.timestamp).toLocaleString('ja-JP')}
          >
            {relativeTime(e.timestamp, now)}
          </span>
        </div>
        {e.detail && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 truncate">{e.detail}</p>
        )}
        {e.target_article_id && (
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500 font-mono">
            記事 …{e.target_article_id.slice(-8)}
          </p>
        )}
      </div>
    </li>
  )
}

export default function Monitor({ loaderData }: Route.ComponentProps) {
  const { timeline, agents, tools, agent, tool, hours, latestActivityEntries } = loaderData
  const revalidator = useRevalidator()
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
  console.log({ stats, activeCount })
  console.log({ events })

  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-8">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">
            エージェントたちの様子
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            直近 {hours} 時間で {timeline.length} 件のアクティビティ ·{' '}
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {activeCount} 名が稼働中
            </span>
            {' · '}
            {revalidator.state === 'idle' ? '⟳ 自動更新' : '更新中…'}
          </p>
        </div>
      </header>

      {stats.length > 0 && (
        <section>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {stats.map((s) => (
              <AgentCard key={s.profile.key} stat={s} />
            ))}
          </div>
        </section>
      )}

      <section className="bg-surface border border-border rounded-xl p-5">
        <Form method="get" className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              エージェント
            </span>
            <select
              name="agent"
              defaultValue={agent}
              className="px-2.5 py-1.5 border rounded-md bg-surface border-border text-sm"
            >
              <option value="">すべて</option>
              {agents.map((a) => (
                <option key={a} value={a}>
                  {getAgentProfile(a).displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 dark:text-slate-400 mb-1">ツール</span>
            <select
              name="tool"
              defaultValue={tool}
              className="px-2.5 py-1.5 border rounded-md bg-surface border-border text-sm"
            >
              <option value="">すべて</option>
              {tools.map((t) => (
                <option key={t} value={t}>
                  {describeTool(t).phrase}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="block text-xs text-slate-500 dark:text-slate-400 mb-1">
              期間 (時間)
            </span>
            <input
              type="number"
              name="hours"
              min={1}
              max={720}
              defaultValue={hours}
              className="px-2.5 py-1.5 border rounded-md w-24 bg-surface border-border text-sm"
            />
          </label>
          <button
            type="submit"
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 text-sm rounded-md transition-colors"
          >
            適用
          </button>
          {(agent || tool) && (
            <a
              href="/monitor"
              className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 py-1.5"
            >
              絞り込み解除
            </a>
          )}
        </Form>
      </section>

      <section>
        <h2 className="text-base font-semibold mb-4">タイムライン</h2>
        {timeline.length === 0 ? (
          <div className="bg-surface border border-border rounded-xl p-10 text-center">
            <p className="text-4xl mb-3">😴</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              この期間にエージェントの活動はありませんでした
            </p>
          </div>
        ) : (
          <ul className="space-y-0">
            {timeline.map((item) =>
              item.kind === 'audit' ? (
                <AuditRow key={item.id} event={item} now={now} />
              ) : (
                <ActivityRow key={item.id} item={item} now={now} />
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  )
}
