import { Form } from 'react-router'
import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/search.ts'

export async function loader({ request }: Route.LoaderArgs) {
  requireUser(request)
  const services = getServices()
  const url = new URL(request.url)
  const q = url.searchParams.get('q') ?? ''
  const tag = url.searchParams.get('tag') ?? ''
  const excludeArchived = url.searchParams.get('archived') !== 'true'
  let hits: ReturnType<typeof services.search.fulltext> = []
  if (q) hits = services.search.fulltext({ q, excludeArchived })
  else if (tag) hits = services.search.byTag(tag)
  return { q, tag, excludeArchived, hits }
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { q, tag, hits, excludeArchived } = loaderData
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">検索</h1>
      <Form method="get" className="flex gap-2 mb-4">
        <input
          name="q"
          defaultValue={q}
          className="flex-1 px-3 py-2 border rounded"
          placeholder="キーワードを入力"
        />
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" name="archived" value="true" defaultChecked={!excludeArchived} />
          アーカイブも含める
        </label>
        <button type="submit" className="bg-blue-600 text-white px-4 rounded">
          検索
        </button>
      </Form>
      {tag && <p className="text-sm text-slate-600 mb-2">タグ「{tag}」</p>}
      <ul className="space-y-2">
        {hits.map((h) => (
          <li key={h.id} className="bg-white p-3 rounded border">
            <a href={`/articles/${h.slug}`} className="text-blue-700 font-semibold">
              {h.title}
            </a>
            <span className="ml-2 text-xs text-slate-500">{h.status}</span>
            {h.snippet && (
              // FTS5 snippet には <mark> が含まれる
              // biome-ignore lint/security/noDangerouslySetInnerHtml: snippet は DB 由来でユーザー入力は事前 escape 不要(FTS5 が囲み)
              <p className="text-sm mt-1" dangerouslySetInnerHTML={{ __html: h.snippet }} />
            )}
          </li>
        ))}
        {hits.length === 0 && <p className="text-sm text-slate-500">結果がありません</p>}
      </ul>
    </div>
  )
}
