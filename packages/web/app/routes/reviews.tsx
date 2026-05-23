import { requireEditor } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/reviews.ts'

export async function loader({ request }: Route.LoaderArgs) {
  requireEditor(request)
  const services = getServices()
  const reviews = services.reviews.listPending()
  // 各 review に紐づく記事タイトルも取って表示
  const enriched = reviews.map((r) => {
    const a = services.articles.read(r.article_id)
    return { ...r, article_title: a?.frontmatter.title ?? '(削除済み)', slug: a?.frontmatter.slug }
  })
  return { reviews: enriched }
}

export default function Reviews({ loaderData }: Route.ComponentProps) {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">承認待ちレビュー</h1>
      {loaderData.reviews.length === 0 && (
        <p className="text-sm text-slate-500">承認待ちのレビューはありません。</p>
      )}
      <ul className="space-y-2">
        {loaderData.reviews.map((r) => (
          <li key={r.id} className="bg-white p-3 rounded border">
            <a href={`/reviews/${r.id}`} className="text-blue-700 font-semibold">
              {r.article_title}
            </a>
            <div className="text-xs text-slate-500">
              変更率: {(r.change_pct * 100).toFixed(1)}% / 作成: {r.created_at}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
