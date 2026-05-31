import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/articles.ts'

const PAGE_SIZE = 100

export async function loader({ request }: Route.LoaderArgs) {
  requireUser(request)
  const services = getServices()
  const url = new URL(request.url)
  const tag = url.searchParams.get('tag') || undefined
  // 公開記事のみを対象に一覧 + タグ絞り込み
  const articles = services.articles.list({ status: 'published', tag, limit: PAGE_SIZE })
  const tags = services.articles.listTags({ status: 'published' })
  return { articles, tags, tag: tag ?? '' }
}

function FreshnessBadge({ rank }: { rank: string }) {
  const color =
    rank === 'fresh'
      ? 'bg-success/15 text-success'
      : rank === 'aging'
        ? 'bg-warning/15 text-warning'
        : rank === 'stale'
          ? 'bg-warning/20 text-warning'
          : 'bg-error/15 text-error'
  return <span className={`ml-2 text-xs px-2 py-0.5 rounded ${color}`}>{rank}</span>
}

export default function Articles({ loaderData }: Route.ComponentProps) {
  const { articles, tags, tag } = loaderData
  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <header>
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">記事一覧</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          {tag ? (
            <>
              タグ「{tag}」の記事 {articles.length} 件
            </>
          ) : (
            <>公開中の記事 {articles.length} 件</>
          )}
        </p>
      </header>

      {tags.length > 0 && (
        <section className="flex flex-wrap gap-1.5">
          <a
            href="/articles"
            className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
              tag === ''
                ? 'bg-primary text-primary-content'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            すべて
          </a>
          {tags.map((t) => (
            <a
              key={t.tag}
              href={`/articles?tag=${encodeURIComponent(t.tag)}`}
              className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
                tag === t.tag
                  ? 'bg-primary text-primary-content'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {t.tag}
              <span className="ml-1 opacity-60 tabular-nums">{t.count}</span>
            </a>
          ))}
        </section>
      )}

      {articles.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {tag ? 'このタグの記事はありません' : 'まだ記事がありません'}
        </p>
      ) : (
        <ul className="space-y-2">
          {articles.map((a) => (
            <li
              key={a.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 rounded-lg transition-colors hover:border-slate-300 dark:hover:border-slate-700"
            >
              <a
                href={`/articles/${a.slug}`}
                className="text-primary font-semibold hover:underline"
              >
                {a.title}
              </a>
              <FreshnessBadge rank={a.freshness_rank} />
              {a.summary && (
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 line-clamp-2">
                  {a.summary}
                </p>
              )}
              {a.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {a.tags.map((t) => (
                    <a
                      key={t}
                      href={`/articles?tag=${encodeURIComponent(t)}`}
                      className="text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-0.5 rounded transition-colors"
                    >
                      {t}
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
