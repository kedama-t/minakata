import { diffLines } from 'diff'
import { Form, redirect } from 'react-router'
import { requireEditor } from '../lib/auth.ts'
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
  return { review, article_title: article?.frontmatter.title ?? '(削除済み)', diff, comments }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = requireEditor(request)
  if (!params.reviewId) throw new Response('Bad Request', { status: 400 })
  const services = getServices()
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  if (intent === 'approve') {
    await services.reviews.approve(params.reviewId, user.id)
  } else if (intent === 'reject') {
    const comment = String(form.get('comment') ?? '').trim()
    if (!comment) return { error: '差し戻し時はコメントが必須' }
    await services.reviews.reject(params.reviewId, user.id, comment)
  } else if (intent === 'comment') {
    const body = String(form.get('body') ?? '').trim()
    if (body) services.reviews.addComment({ review_id: params.reviewId, author_id: user.id, body })
    return null
  }
  throw redirect('/reviews')
}

export default function ReviewPage({ loaderData, actionData }: Route.ComponentProps) {
  const { review, article_title, diff, comments } = loaderData
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <header>
        <a href="/reviews" className="text-primary text-sm hover:underline">
          ← レビュー一覧
        </a>
        <h1 className="text-2xl font-bold mt-1">{article_title}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
          変更率: {(review.change_pct * 100).toFixed(1)}% / 状態: {review.status}
        </p>
      </header>

      <section className="bg-surface border rounded p-4">
        <h2 className="text-lg font-bold mb-2">差分</h2>
        <pre className="text-sm font-mono leading-tight whitespace-pre-wrap">
          {diff.map((chunk, i) => (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: diff の順序が key として安定
              key={i}
              className={
                chunk.added
                  ? 'bg-green-100 dark:bg-green-900/40 text-green-900 dark:text-green-200'
                  : chunk.removed
                    ? 'bg-red-100 dark:bg-red-900/40 text-red-900 dark:text-red-200 line-through'
                    : 'text-slate-700 dark:text-slate-300'
              }
            >
              {chunk.value}
            </span>
          ))}
        </pre>
      </section>

      {review.status === 'pending' && (
        <section className="bg-surface border rounded p-4 space-y-3">
          <h2 className="text-lg font-bold">判定</h2>
          <Form method="post" className="flex gap-2">
            <button
              type="submit"
              name="intent"
              value="approve"
              className="bg-green-600 text-white px-4 py-2 rounded"
            >
              承認
            </button>
          </Form>
          <Form method="post" className="space-y-2">
            <textarea
              name="comment"
              required
              rows={3}
              className="w-full px-3 py-2 border rounded text-sm"
              placeholder="差し戻し理由(エージェントへのフィードバックになる)"
            />
            <button
              type="submit"
              name="intent"
              value="reject"
              className="bg-orange-600 text-white px-4 py-2 rounded"
            >
              差し戻し
            </button>
            {actionData?.error && (
              <p className="text-red-600 dark:text-red-400 text-sm">{actionData.error}</p>
            )}
          </Form>
        </section>
      )}

      <section className="bg-surface border rounded p-4">
        <h2 className="text-lg font-bold mb-2">コメント</h2>
        <ul className="space-y-1 text-sm">
          {comments.map((c) => (
            <li key={c.id} className="border-b pb-1">
              <span className="text-slate-500 dark:text-slate-400 dark:text-slate-500 text-xs">
                {c.author_id} - {c.created_at}
              </span>
              <p>{c.body}</p>
            </li>
          ))}
          {comments.length === 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500">
              まだコメントはありません。
            </p>
          )}
        </ul>
        <Form method="post" className="mt-3 flex gap-2">
          <input
            name="body"
            className="flex-1 px-3 py-2 border rounded"
            placeholder="行コメントの代わりに全体メモを残す"
          />
          <button
            type="submit"
            name="intent"
            value="comment"
            className="bg-slate-600 text-white px-3 py-2 rounded"
          >
            追加
          </button>
        </Form>
      </section>
    </div>
  )
}
