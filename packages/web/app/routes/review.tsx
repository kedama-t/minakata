import { diffLines } from 'diff'
import { Form, redirect } from 'react-router'
import { detectLocale, getDict, useDict } from '../i18n/index.ts'
import { assertSameOrigin, requireEditor } from '../lib/auth.ts'
import { formatDateTime, useTimezone } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/review.ts'

export async function loader({ request, params }: Route.LoaderArgs) {
  requireEditor(request)
  if (!params.reviewId) throw new Response('Bad Request', { status: 400 })
  const services = getServices()
  const review = services.reviews.get(params.reviewId)
  if (!review) throw new Response('Not Found', { status: 404 })
  const article = services.articles.read(review.article_id)
  const before = article?.body ?? ''
  const diff = diffLines(before, review.proposed_body)
  const comments = services.reviews.listComments(review.id)
  const t = getDict(detectLocale(request))
  return { review, article_title: article?.frontmatter.title ?? t.common.deleted, diff, comments }
}

export async function action({ request, params }: Route.ActionArgs) {
  assertSameOrigin(request)
  const user = requireEditor(request)
  if (!params.reviewId) throw new Response('Bad Request', { status: 400 })
  const services = getServices()
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  if (intent === 'approve') {
    await services.reviews.approve(params.reviewId, user.id)
  } else if (intent === 'reject') {
    const comment = String(form.get('comment') ?? '').trim()
    if (!comment) return { error: getDict(detectLocale(request)).review.errorCommentRequired }
    await services.reviews.reject(params.reviewId, user.id, comment)
  } else if (intent === 'comment') {
    const body = String(form.get('body') ?? '').trim()
    if (body) services.reviews.addComment({ review_id: params.reviewId, author_id: user.id, body })
    return null
  }
  throw redirect('/reviews')
}

export default function ReviewPage({ loaderData, actionData }: Route.ComponentProps) {
  const t = useDict()
  const { review, article_title, diff, comments } = loaderData
  const tz = useTimezone()
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <a href="/reviews" className="text-primary text-sm hover:underline">
          {t.review.backToList}
        </a>
        <h1 className="text-2xl font-bold mt-1">{article_title}</h1>
        <p className="text-xs text-base-content/60">
          {t.review.meta((review.change_pct * 100).toFixed(1), review.status)}
        </p>
      </header>

      <section className="bg-surface border rounded p-4">
        <h2 className="text-lg font-bold mb-2">{t.review.diff}</h2>
        <pre className="text-sm font-mono leading-tight whitespace-pre-wrap">
          {diff.map((chunk, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: diff の順序が key として安定
              key={i}
              className={
                chunk.added
                  ? 'bg-success/15 text-success'
                  : chunk.removed
                    ? 'bg-error/15 text-error line-through'
                    : 'text-base-content/80'
              }
            >
              {chunk.value}
            </span>
          ))}
        </pre>
      </section>

      {review.status === 'pending' && (
        <section className="bg-surface border rounded p-4 space-y-3">
          <h2 className="text-lg font-bold">{t.review.judgement}</h2>
          <Form method="post" className="flex gap-2">
            <button type="submit" name="intent" value="approve" className="btn btn-success btn-sm">
              {t.review.approve}
            </button>
          </Form>
          <Form method="post" className="space-y-2">
            <textarea
              name="comment"
              required
              rows={3}
              className="w-full px-3 py-2 border rounded text-sm"
              placeholder={t.review.rejectPlaceholder}
            />
            <button type="submit" name="intent" value="reject" className="btn btn-error btn-sm">
              {t.review.reject}
            </button>
            {actionData?.error && <p className="text-error text-sm">{actionData.error}</p>}
          </Form>
        </section>
      )}

      <section className="bg-surface border rounded p-4">
        <h2 className="text-lg font-bold mb-2">{t.review.comments}</h2>
        <ul className="space-y-1 text-sm">
          {comments.map((c) => (
            <li key={c.id} className="border-b pb-1">
              <span className="text-base-content/60 text-xs">
                {c.author_id} - {formatDateTime(c.created_at, tz)}
              </span>
              <p>{c.body}</p>
            </li>
          ))}
          {comments.length === 0 && (
            <p className="text-xs text-base-content/60">{t.review.commentEmpty}</p>
          )}
        </ul>
        <Form method="post" className="mt-3 flex gap-2">
          <input
            name="body"
            className="flex-1 px-3 py-2 border rounded"
            placeholder={t.review.commentPlaceholder}
          />
          <button type="submit" name="intent" value="comment" className="btn btn-neutral btn-sm">
            {t.common.add}
          </button>
        </Form>
      </section>
    </div>
  )
}
