import { Form } from 'react-router'
import { requireEditor, requireUser } from '../lib/auth.ts'
import { ArticleMarkdown } from '../lib/markdown.tsx'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/article.ts'

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = requireUser(request)
  const services = getServices()
  if (!params.slug) throw new Response('Bad Request', { status: 400 })
  const article = services.articles.read(params.slug)
  if (!article) throw new Response('Not Found', { status: 404 })
  await services.articles.touchAccessed(article.frontmatter.id)
  services.db
    .prepare(
      'INSERT INTO read_status (user_id, article_id, read_at) VALUES (?, ?, ?) ON CONFLICT(user_id, article_id) DO UPDATE SET read_at = excluded.read_at',
    )
    .run(user.id, article.frontmatter.id, new Date().toISOString())
  const comments = services.comments.listByArticle(article.frontmatter.id)
  const related = services.search.similar(article.frontmatter.id, 5)
  return { article, comments, related, role: user.role }
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = requireEditor(request)
  const services = getServices()
  if (!params.slug) throw new Response('Bad Request', { status: 400 })
  const article = services.articles.read(params.slug)
  if (!article) throw new Response('Not Found', { status: 404 })
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  if (intent === 'add_comment') {
    const body = String(form.get('body') ?? '').trim()
    const anchor = String(form.get('anchor') ?? '').trim() || null
    if (!body) return { error: 'コメント本文が空' }
    services.comments.add({
      article_id: article.frontmatter.id,
      author_id: user.id,
      body,
      anchor,
    })
    // 追加調査が必要なコメントなら interactive タスクとしてキューに投入(US-3.2)
    if (form.get('request_research') === 'on') {
      services.tasks.enqueue({
        type: 'research_followup',
        priority: 'interactive',
        payload: { article_id: article.frontmatter.id, comment: body, anchor },
        requested_by: user.id,
      })
    }
    return { ok: true }
  }
  if (intent === 'resolve' && form.get('comment_id')) {
    services.comments.resolve(String(form.get('comment_id')))
    return { ok: true }
  }
  if (intent === 'unarchive') {
    await services.articles.unarchive(article.frontmatter.id, `user:${user.id}`)
    services.tasks.enqueue({
      type: 'refresh',
      priority: 'urgent',
      payload: { article_id: article.frontmatter.id, reason: 'unarchived' },
      requested_by: user.id,
    })
    services.audit.log({
      actor: `user:${user.id}`,
      tool_name: 'web.unarchive_article',
      target_article_id: article.frontmatter.id,
    })
    return { ok: true }
  }
  return { error: 'unknown intent' }
}

export default function ArticlePage({ loaderData, actionData }: Route.ComponentProps) {
  const { article, comments, related, role } = loaderData
  const canEdit = role !== 'viewer'
  return (
    <article className="max-w-3xl mx-auto p-6">
      <h1 className="text-3xl font-bold mb-1">{article.frontmatter.title}</h1>
      <div className="text-xs text-slate-500 mb-6 flex items-center gap-2">
        <span>
          最終更新: {article.frontmatter.updated_at} / 鮮度: {article.frontmatter.freshness_rank} /
          状態: {article.frontmatter.status}
        </span>
        {canEdit && article.frontmatter.status === 'archived' && (
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="unarchive" />
            <button type="submit" className="text-xs bg-amber-600 text-white px-2 py-1 rounded">
              アーカイブ解除
            </button>
          </Form>
        )}
      </div>
      {article.frontmatter.summary && (
        <div className="bg-slate-100 p-3 rounded mb-6 text-sm">{article.frontmatter.summary}</div>
      )}
      <ArticleMarkdown source={article.body} />
      {article.frontmatter.sources.length > 0 && (
        <section className="mt-8 border-t pt-4">
          <h2 className="text-lg font-bold mb-2">出典</h2>
          <ul className="space-y-1 text-sm">
            {article.frontmatter.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} className="text-blue-700 hover:underline">
                  {s.url}
                </a>
                <span className="text-slate-500 ml-2">取得: {s.fetched_at}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-8 border-t pt-4">
          <h2 className="text-lg font-bold mb-2">関連記事</h2>
          <ul className="space-y-1 text-sm">
            {related.map((r) => (
              <li key={r.id}>
                <a href={`/articles/${r.slug}`} className="text-blue-700 hover:underline">
                  {r.title}
                </a>
                {r.status === 'archived' && (
                  <span className="ml-2 text-xs text-slate-500">(archived)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 border-t pt-4">
        <h2 className="text-lg font-bold mb-2">コメント</h2>
        <ul className="space-y-2">
          {comments.map((c) => (
            <li
              key={c.id}
              className={`bg-slate-50 p-2 rounded ${c.status === 'resolved' ? 'opacity-50' : ''}`}
            >
              <div className="text-xs text-slate-500">
                {c.author_id} - {c.created_at}
                {c.anchor && <> / @{c.anchor}</>}
              </div>
              <p className="text-sm">{c.body}</p>
              {canEdit && c.status === 'open' && (
                <Form method="post" className="inline">
                  <input type="hidden" name="intent" value="resolve" />
                  <input type="hidden" name="comment_id" value={c.id} />
                  <button type="submit" className="text-xs text-blue-700 hover:underline">
                    解決済みにする
                  </button>
                </Form>
              )}
            </li>
          ))}
          {comments.length === 0 && (
            <p className="text-xs text-slate-500">コメントはまだありません。</p>
          )}
        </ul>
        {canEdit && (
          <Form method="post" className="mt-4 space-y-2 bg-white p-3 rounded border">
            <input type="hidden" name="intent" value="add_comment" />
            <input
              name="anchor"
              className="w-full px-2 py-1 border rounded text-xs"
              placeholder="セクション/行アンカー(任意)"
            />
            <textarea
              name="body"
              required
              rows={3}
              className="w-full px-3 py-2 border rounded text-sm"
              placeholder="この部分のセキュリティ的な懸念について調べてほしい..."
            />
            <label className="flex items-center gap-1 text-xs text-slate-600">
              <input type="checkbox" name="request_research" />
              追加調査タスクとしてキューに投入する
            </label>
            {actionData?.error && <p className="text-red-600 text-xs">{actionData.error}</p>}
            {actionData?.ok && <p className="text-green-600 text-xs">登録しました</p>}
            <button type="submit" className="bg-blue-600 text-white px-3 py-1.5 rounded text-sm">
              コメントを追加
            </button>
          </Form>
        )}
      </section>
    </article>
  )
}
