import { useEffect } from 'react'
import { Form, useRevalidator } from 'react-router'
import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/monitor.ts'

const PAGE_SIZE = 100
const REFRESH_INTERVAL_MS = 10_000

export async function loader({ request }: Route.LoaderArgs) {
  requireUser(request)
  const url = new URL(request.url)
  const agent = url.searchParams.get('agent') || undefined
  const tool = url.searchParams.get('tool') || undefined
  const hoursParam = url.searchParams.get('hours')
  const hours = hoursParam ? Math.max(1, Math.min(720, Number(hoursParam) || 24)) : 24
  const since = new Date(Date.now() - hours * 3_600_000).toISOString()

  const services = getServices()
  const events = services.audit.list({
    limit: PAGE_SIZE,
    since,
    agent_name: agent,
    tool_name: tool,
  })
  const agents = services.audit.distinctAgents()
  const tools = services.audit.distinctTools()
  return { events, agents, tools, agent: agent ?? '', tool: tool ?? '', hours }
}

function ToolBadge({ name }: { name: string }) {
  // tool_name の系統で色分け
  const palette = name.includes('archive')
    ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300'
    : name.includes('create') || name.includes('update')
      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
      : name.includes('task')
        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300'
        : name.includes('message') || name.includes('post')
          ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300'
          : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
  return <span className={`text-xs px-2 py-0.5 rounded ${palette}`}>{name}</span>
}

function ActorBadge({ actor }: { actor: string }) {
  const isAgent = actor.startsWith('agent:') || actor === 'hermes' || actor.startsWith('hermes:')
  const cls = isAgent
    ? 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
    : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
  return <span className={`text-xs px-2 py-0.5 rounded ${cls}`}>{actor}</span>
}

export default function Monitor({ loaderData }: Route.ComponentProps) {
  const { events, agents, tools, agent, tool, hours } = loaderData
  const revalidator = useRevalidator()
  useEffect(() => {
    const id = setInterval(() => {
      if (revalidator.state === 'idle') revalidator.revalidate()
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [revalidator])

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-baseline gap-3 mb-4">
        <h1 className="text-2xl font-bold">エージェント稼働モニター</h1>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          直近 {hours} 時間 · {events.length} 件 ·{' '}
          {revalidator.state === 'idle' ? '自動更新中' : '更新中…'}
        </span>
      </div>
      <Form method="get" className="flex flex-wrap items-end gap-3 mb-4">
        <label className="text-sm">
          エージェント
          <select
            name="agent"
            defaultValue={agent}
            className="block mt-1 px-2 py-1 border rounded bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
          >
            <option value="">すべて</option>
            {agents.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          ツール
          <select
            name="tool"
            defaultValue={tool}
            className="block mt-1 px-2 py-1 border rounded bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
          >
            <option value="">すべて</option>
            {tools.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          期間 (時間)
          <input
            type="number"
            name="hours"
            min={1}
            max={720}
            defaultValue={hours}
            className="block mt-1 px-2 py-1 border rounded w-24 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
          />
        </label>
        <button type="submit" className="bg-blue-600 text-white px-3 py-1.5 text-sm rounded">
          適用
        </button>
      </Form>
      <ul className="space-y-1">
        {events.map((e) => {
          const meta = e.metadata ? JSON.stringify(e.metadata) : ''
          return (
            <li
              key={e.id}
              className="bg-white dark:bg-slate-800 p-3 rounded border border-slate-200 dark:border-slate-700"
            >
              <div className="flex items-center flex-wrap gap-2 text-xs">
                <span className="text-slate-500 dark:text-slate-400 tabular-nums">
                  {new Date(e.timestamp).toLocaleString('ja-JP')}
                </span>
                <ActorBadge actor={e.actor} />
                {e.agent_name && (
                  <span className="text-slate-500 dark:text-slate-400">via {e.agent_name}</span>
                )}
                <ToolBadge name={e.tool_name} />
                {e.target_article_id && (
                  <span className="text-slate-500 dark:text-slate-400">
                    article: {e.target_article_id.slice(-8)}
                  </span>
                )}
                {e.cost_usd > 0 && (
                  <span className="text-slate-500 dark:text-slate-400 ml-auto">
                    ${e.cost_usd.toFixed(4)}
                  </span>
                )}
              </div>
              {meta && (
                <details className="text-xs mt-1">
                  <summary className="cursor-pointer text-slate-500 dark:text-slate-400">
                    metadata
                  </summary>
                  <pre className="mt-1 p-2 bg-slate-50 dark:bg-slate-900 rounded overflow-x-auto">
                    {meta}
                  </pre>
                </details>
              )}
            </li>
          )
        })}
        {events.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            該当期間にエージェント活動はありません
          </p>
        )}
      </ul>
    </div>
  )
}
