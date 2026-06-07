import { useState } from 'react'
import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/articles.ts'

const PAGE_SIZE = 100

export async function loader({ request }: Route.LoaderArgs) {
  requireUser(request)
  const services = getServices()
  const url = new URL(request.url)
  const tag = url.searchParams.get('tag') || undefined
  // archived 以外を全て表示(pending_approval も含む)
  const articles = services.articles.list({ excludeArchived: true, tag, limit: PAGE_SIZE })
  const tags = services.articles.listTags({ excludeArchived: true })
  const likeCounts = services.feedback.countsFor(articles.map((a) => a.id))
  return { articles, tags, tag: tag ?? '', likeCounts }
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

function PendingBadge({ status }: { status: string }) {
  if (status !== 'pending_approval') return null
  return (
    <span className="ml-2 text-xs px-2 py-0.5 rounded bg-warning/20 text-warning font-medium">
      レビュー中
    </span>
  )
}

const TAG_LIMIT = 20

function TagCloud({
  tags,
  currentTag,
}: { tags: { tag: string; count: number }[]; currentTag: string }) {
  const [expanded, setExpanded] = useState(false)
  const hasMore = tags.length > TAG_LIMIT
  const visibleTags = expanded ? tags : tags.slice(0, TAG_LIMIT)
  return (
    <section className="flex flex-wrap gap-1.5">
      <a
        href="/articles"
        className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
          currentTag === ''
            ? 'bg-primary text-primary-content'
            : 'bg-base-200 text-base-content/70 hover:bg-base-300'
        }`}
      >
        すべて
      </a>
      {visibleTags.map((t) => (
        <a
          key={t.tag}
          href={`/articles?tag=${encodeURIComponent(t.tag)}`}
          className={`text-xs px-2.5 py-1 rounded-full transition-colors ${
            currentTag === t.tag
              ? 'bg-primary text-primary-content'
              : 'bg-base-200 text-base-content/70 hover:bg-base-300'
          }`}
        >
          {t.tag}
          <span className="ml-1 opacity-60 tabular-nums">{t.count}</span>
        </a>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs px-2.5 py-1 rounded-full bg-base-200 text-base-content/50 hover:bg-base-300 transition-colors"
        >
          {expanded ? '閉じる' : `+${tags.length - TAG_LIMIT}件`}
        </button>
      )}
    </section>
  )
}

export default function Articles({ loaderData }: Route.ComponentProps) {
  const { articles, tags, tag, likeCounts } = loaderData
  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <header>
        <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">記事一覧</h1>
        <p className="text-sm text-base-content/60 mt-1">
          {tag ? (
            <>
              タグ「{tag}」の記事 {articles.length} 件
            </>
          ) : (
            <>記事 {articles.length} 件（アーカイブを除く）</>
          )}
        </p>
      </header>

      {tags.length > 0 && <TagCloud tags={tags} currentTag={tag} />}

      {articles.length === 0 ? (
        <p className="text-sm text-base-content/60">
          {tag ? 'このタグの記事はありません' : 'まだ記事がありません'}
        </p>
      ) : (
        <ul className="space-y-2">
          {articles.map((a) => (
            <li
              key={a.id}
              className="bg-surface border border-border p-4 rounded-lg transition-colors hover:border-border-strong"
            >
              <a
                href={`/articles/${a.slug}`}
                className="text-primary font-semibold hover:underline"
              >
                {a.title}
              </a>
              <FreshnessBadge rank={a.freshness_rank} />
              <PendingBadge status={a.status} />
              {(likeCounts[a.id] ?? 0) > 0 && (
                <span className="ml-2 text-xs text-primary tabular-nums">♥ {likeCounts[a.id]}</span>
              )}
              {a.summary && (
                <p className="text-sm text-base-content/60 mt-1.5 line-clamp-2">{a.summary}</p>
              )}
              {a.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {a.tags.map((t) => (
                    <a
                      key={t}
                      href={`/articles?tag=${encodeURIComponent(t)}`}
                      className="text-xs bg-base-200 hover:bg-base-300 px-2 py-0.5 rounded transition-colors text-base-content/70"
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
