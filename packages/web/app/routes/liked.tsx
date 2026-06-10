import { FreshnessBadge } from '../components/ui/freshness-badge.tsx'
import { useDict } from '../i18n/index.ts'
import { articleHref } from '../lib/article-link.ts'
import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/liked.ts'

export async function loader({ request }: Route.LoaderArgs) {
  const user = requireUser(request)
  const services = getServices()
  const ids = services.feedback.likedArticleIds(user.id)
  const found = services.articles.listByIds(ids, { excludeArchived: true })
  // listByIds の結果はいいね順を保証しないため、ID 順(いいねした新しい順)に並べ替える
  const byId = new Map(found.map((a) => [a.id, a]))
  const articles = ids.map((id) => byId.get(id)).filter((a) => a !== undefined)
  const likeCounts = services.feedback.countsFor(articles.map((a) => a.id))
  return { articles, likeCounts }
}

export default function Liked({ loaderData }: Route.ComponentProps) {
  const t = useDict()
  const { articles, likeCounts } = loaderData
  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <header>
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">{t.liked.title}</h1>
        <p className="text-sm text-base-content/60 mt-1">{t.liked.count(articles.length)}</p>
      </header>

      {articles.length === 0 ? (
        <p className="text-sm text-base-content/60">{t.liked.empty}</p>
      ) : (
        <ul className="space-y-2">
          {articles.map((a) => (
            <li
              key={a.id}
              className="bg-surface border border-border p-4 rounded-lg transition-colors hover:border-border-strong"
            >
              <a href={articleHref(a.slug)} className="text-primary font-semibold hover:underline">
                {a.title}
              </a>
              <span className="ml-2">
                <FreshnessBadge rank={a.freshness_rank} />
              </span>
              {(likeCounts[a.id] ?? 0) > 0 && (
                <span className="ml-2 text-xs text-primary tabular-nums">♥ {likeCounts[a.id]}</span>
              )}
              {a.summary && (
                <p className="text-sm text-base-content/60 mt-1.5 line-clamp-2">{a.summary}</p>
              )}
              {a.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {a.tags.map((tag) => (
                    <a
                      key={tag}
                      href={`/articles?tag=${encodeURIComponent(tag)}`}
                      className="text-xs bg-base-200 hover:bg-base-300 px-2 py-0.5 rounded transition-colors text-base-content/70"
                    >
                      {tag}
                    </a>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
