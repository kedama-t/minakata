import { detectLocale, getDict, useDict } from '../i18n/index.ts'
import { requireEditor } from '../lib/auth.ts'
import { formatDateTime, useTimezone } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/reviews.ts'

export async function loader({ request }: Route.LoaderArgs) {
  requireEditor(request)
  const t = getDict(detectLocale(request))
  const services = getServices()
  const reviews = services.reviews.listPending()
  // 各 review に紐づく記事タイトルも取って表示
  const enriched = reviews.map((r) => {
    const a = services.articles.read(r.article_id)
    return {
      ...r,
      article_title: a?.frontmatter.title ?? t.common.deleted,
      slug: a?.frontmatter.slug,
    }
  })
  return { reviews: enriched }
}

export default function Reviews({ loaderData }: Route.ComponentProps) {
  const t = useDict()
  const tz = useTimezone()
  return (
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">{t.reviews.title}</h1>
      {loaderData.reviews.length === 0 && (
        <p className="text-sm text-base-content/60">{t.reviews.empty}</p>
      )}
      <ul className="space-y-2">
        {loaderData.reviews.map((r) => (
          <li key={r.id} className="bg-surface p-3 rounded border">
            <a href={`/reviews/${r.id}`} className="text-primary font-semibold hover:underline">
              {r.article_title}
            </a>
            <div className="text-xs text-base-content/60">
              {t.reviews.changePct}: {(r.change_pct * 100).toFixed(1)}% / {t.reviews.createdAt}:{' '}
              {formatDateTime(r.created_at, tz)}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
