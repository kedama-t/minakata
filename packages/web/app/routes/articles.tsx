import type { ArticleSortKey, SortOrder } from '@minakata/core'
import { useState } from 'react'
import { Form, useSubmit } from 'react-router'
import { FreshnessBadge } from '../components/ui/freshness-badge.tsx'
import { useDict } from '../i18n/index.ts'
import { articleHref } from '../lib/article-link.ts'
import { requireUser } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/articles.ts'

const PAGE_SIZE = 100

const SORT_KEYS: ArticleSortKey[] = ['updated_at', 'created_at', 'last_researched_at']

function parseSort(v: string | null): ArticleSortKey {
  return SORT_KEYS.includes(v as ArticleSortKey) ? (v as ArticleSortKey) : 'updated_at'
}

function parseOrder(v: string | null): SortOrder {
  return v === 'asc' ? 'asc' : 'desc'
}

export async function loader({ request }: Route.LoaderArgs) {
  requireUser(request)
  const services = getServices()
  const url = new URL(request.url)
  const tag = url.searchParams.get('tag') || undefined
  const sortBy = parseSort(url.searchParams.get('sort'))
  const order = parseOrder(url.searchParams.get('order'))
  // archived 以外を全て表示(pending_approval も含む)
  const articles = services.articles.list({
    excludeArchived: true,
    tag,
    limit: PAGE_SIZE,
    sortBy,
    order,
  })
  const tags = services.articles.listTags({ excludeArchived: true })
  const likeCounts = services.feedback.countsFor(articles.map((a) => a.id))
  return { articles, tags, tag: tag ?? '', likeCounts, sortBy, order }
}

function PendingBadge({ status }: { status: string }) {
  const t = useDict()
  if (status !== 'pending_approval') return null
  return (
    <span className="ml-2 text-xs px-2 py-0.5 rounded bg-warning/20 text-warning font-medium">
      {t.common.inReview}
    </span>
  )
}

const TAG_LIMIT = 20

function TagCloud({
  tags,
  currentTag,
}: { tags: { tag: string; count: number }[]; currentTag: string }) {
  const t = useDict()
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
        {t.common.all}
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
          {expanded ? t.articles.collapse : t.articles.moreTags(tags.length - TAG_LIMIT)}
        </button>
      )}
    </section>
  )
}

// 並べ替え UI。select 変更で即時送信し、tag 絞り込みは hidden で引き継ぐ
function SortControl({
  tag,
  sortBy,
  order,
}: { tag: string; sortBy: ArticleSortKey; order: SortOrder }) {
  const t = useDict()
  const submit = useSubmit()
  const selectClass =
    'text-xs px-2 py-1 rounded bg-base-200 text-base-content/80 hover:bg-base-300 transition-colors'
  return (
    <Form
      method="get"
      className="flex items-center gap-2"
      onChange={(e) => submit(e.currentTarget)}
    >
      {tag && <input type="hidden" name="tag" value={tag} />}
      <span className="text-xs text-base-content/50">{t.articles.sortLabel}</span>
      <select name="sort" defaultValue={sortBy} className={selectClass}>
        <option value="updated_at">{t.articles.sortUpdated}</option>
        <option value="created_at">{t.articles.sortCreated}</option>
        <option value="last_researched_at">{t.articles.sortResearched}</option>
      </select>
      <select name="order" defaultValue={order} className={selectClass}>
        <option value="desc">{t.articles.orderDesc}</option>
        <option value="asc">{t.articles.orderAsc}</option>
      </select>
    </Form>
  )
}

export default function Articles({ loaderData }: Route.ComponentProps) {
  const t = useDict()
  const { articles, tags, tag, likeCounts, sortBy, order } = loaderData
  return (
    <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 lg:py-10 space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl lg:text-3xl font-semibold tracking-tight">{t.articles.title}</h1>
          <p className="text-sm text-base-content/60 mt-1">
            {tag
              ? t.articles.countByTag(tag, articles.length)
              : t.articles.countAll(articles.length)}
          </p>
        </div>
        <SortControl tag={tag} sortBy={sortBy} order={order} />
      </header>

      {tags.length > 0 && <TagCloud tags={tags} currentTag={tag} />}

      {articles.length === 0 ? (
        <p className="text-sm text-base-content/60">
          {tag ? t.articles.emptyByTag : t.articles.empty}
        </p>
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
