import { Form } from 'react-router'
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
  return { recentUpdates, newToday, changelogs, canEdit: user.role !== 'viewer' }
}

function QuickActions({ canEdit }: { canEdit: boolean }) {
  return (
    <section className="bg-white border rounded p-4">
      <h2 className="text-sm font-semibold text-slate-500 mb-3">クイックアクション</h2>
      <Form method="get" action="/search" className="flex gap-2 mb-3">
        <input
          name="q"
          className="flex-1 px-3 py-2 border rounded text-base"
          placeholder="ナレッジを検索 (例: React Router v7 framework mode)"
          autoComplete="off"
        />
        <button type="submit" className="bg-blue-600 text-white px-4 rounded">
          検索
        </button>
      </Form>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          <a
            href="/chat/new"
            className="bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700"
          >
            + 新規対話
          </a>
          <a
            href="/chat/new?kind=knowledge"
            className="bg-purple-600 text-white px-3 py-2 rounded text-sm hover:bg-purple-700"
          >
            ? ナレッジ質問
          </a>
          <a
            href="/topics"
            className="border border-slate-300 px-3 py-2 rounded text-sm hover:bg-slate-50"
          >
            購読トピックを編集
          </a>
        </div>
      )}
    </section>
  )
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const { recentUpdates, newToday, changelogs, canEdit } = loaderData
  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <QuickActions canEdit={canEdit} />
      {changelogs.length > 0 && (
        <section className="bg-white border rounded p-4">
          <h2 className="text-xl font-bold mb-3">ChangeLog 日報</h2>
          <ul className="space-y-1 text-sm">
            {changelogs.map((c) => (
              <li key={c.id}>
                <a href={`/articles/${c.slug}`} className="text-blue-700 hover:underline">
                  {c.title}
                </a>
                <span className="text-slate-500 ml-2 text-xs">{c.updated_at}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="text-xl font-bold mb-3">昨夜の更新</h2>
        <ArticleList items={recentUpdates} emptyMessage="まだ更新がありません" />
      </section>
      <section>
        <h2 className="text-xl font-bold mb-3">新規作成された記事</h2>
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
  if (items.length === 0) return <p className="text-sm text-slate-500">{emptyMessage}</p>
  return (
    <ul className="space-y-3">
      {items.map((a) => (
        <li key={a.id} className="bg-white p-4 rounded border">
          <a href={`/articles/${a.slug}`} className="text-blue-700 font-semibold hover:underline">
            {a.title}
          </a>
          <FreshnessBadge rank={a.freshness_rank} />
          {a.summary && <p className="text-sm text-slate-600 mt-1">{a.summary}</p>}
          {a.tags.length > 0 && (
            <div className="flex gap-1 mt-2">
              {a.tags.map((t) => (
                <a
                  key={t}
                  href={`/search?tag=${encodeURIComponent(t)}`}
                  className="text-xs bg-slate-100 px-2 py-0.5 rounded"
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
      ? 'bg-green-100 text-green-700'
      : rank === 'aging'
        ? 'bg-yellow-100 text-yellow-700'
        : rank === 'stale'
          ? 'bg-orange-100 text-orange-700'
          : 'bg-red-100 text-red-700'
  return <span className={`ml-2 text-xs px-2 py-0.5 rounded ${color}`}>{rank}</span>
}
