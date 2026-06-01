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
        <button type="submit" className="btn btn-primary btn-sm">
          検索
        </button>
      </Form>
      {tag && <p className="text-sm text-base-content/60 mb-2">タグ「{tag}」</p>}
      <ul className="space-y-2">
        {hits.map((h) => (
          <li key={h.id} className="bg-surface p-3 rounded border">
            <a href={`/articles/${h.slug}`} className="text-primary font-semibold hover:underline">
              {h.title}
            </a>
            {h.status === 'pending_approval' && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded bg-warning/20 text-warning font-medium">
                レビュー中
              </span>
            )}
            {h.snippet.length > 0 && (
              <p className="text-sm mt-1">
                {h.snippet.map((seg, i) =>
                  seg.mark ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: snippet segments are positional
                    <mark key={i} className="bg-yellow-200 dark:bg-yellow-700">
                      {seg.text}
                    </mark>
                  ) : (
                    // biome-ignore lint/suspicious/noArrayIndexKey: snippet segments are positional
                    <span key={i}>{seg.text}</span>
                  ),
                )}
              </p>
            )}
          </li>
        ))}
        {hits.length === 0 && <p className="text-sm text-base-content/60">結果がありません</p>}
      </ul>
    </div>
  )
}
