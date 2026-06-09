import { Form } from 'react-router'
import { Avatar, UserAvatar } from '../components/ui/avatar.tsx'
import { FreshnessBadge } from '../components/ui/freshness-badge.tsx'
import { getAgentProfile } from '../lib/agent-profiles.ts'
import { articleHref, resolveIdRefs } from '../lib/article-link.ts'
import { assertSameOrigin, requireEditor, requireUser } from '../lib/auth.ts'
import { formatDateTime, useTimezone } from '../lib/date.ts'
import { ArticleMarkdown } from '../lib/markdown.tsx'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/article.ts'

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = requireUser(request)
  const services = getServices()
  const slug = params['*']
  if (!slug) throw new Response('Bad Request', { status: 400 })
  const article = services.articles.read(slug)
  if (!article) throw new Response('Not Found', { status: 404 })
  await services.articles.touchAccessed(article.frontmatter.id)
  services.db
    .prepare(
      'INSERT INTO read_status (user_id, article_id, read_at) VALUES (?, ?, ?) ON CONFLICT(user_id, article_id) DO UPDATE SET read_at = excluded.read_at',
    )
    .run(user.id, article.frontmatter.id, new Date().toISOString())
  const comments = services.comments.listByArticle(article.frontmatter.id)
  // コメント投稿者 id → 表示名(email)。アバターと著者名の表示に使う
  const authorNames: Record<string, string> = {}
  for (const c of comments) {
    if (!authorNames[c.author_id]) {
      authorNames[c.author_id] = services.auth.findUserById(c.author_id)?.email ?? c.author_id
    }
  }
  const related = services.search.similar(article.frontmatter.id, 5)
  const body = resolveIdRefs(article.body, (id) => services.articles.read(id))
  const likeCount = services.feedback.countByArticle(article.frontmatter.id)
  const liked = services.feedback.isLikedBy(article.frontmatter.id, user.id)
  // アーカイブ承認待ち中なら再提案ボタンを隠し、状態を表示するために取得する
  const archivePending = services.archives.findActive(article.frontmatter.id) !== null
  return {
    article,
    body,
    comments,
    authorNames,
    related,
    role: user.role,
    likeCount,
    liked,
    archivePending,
  }
}

export async function action({ request, params }: Route.ActionArgs) {
  assertSameOrigin(request)
  // いいねは viewer も可能。それ以外の編集系操作は editor 以上が必要
  const user = requireUser(request)
  const services = getServices()
  const slug = params['*']
  if (!slug) throw new Response('Bad Request', { status: 400 })
  const article = services.articles.read(slug)
  if (!article) throw new Response('Not Found', { status: 404 })
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  if (intent === 'toggle_like') {
    const result = services.feedback.toggle(article.frontmatter.id, user.id)
    return { ok: true, like: result }
  }
  // 以降は editor 以上の操作
  requireEditor(request)
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
  if (intent === 'archive') {
    // 即時アーカイブせず承認ゲートに回す(§6)。admin が押しても同様に proposed を残す
    const reason = String(form.get('reason') ?? '').trim()
    const proposal = services.archives.propose({
      article_id: article.frontmatter.id,
      proposed_by: `user:${user.id}`,
      ...(reason && { reason }),
    })
    services.audit.log({
      actor: `user:${user.id}`,
      tool_name: 'web.archive_article',
      target_article_id: article.frontmatter.id,
      metadata: { proposal_id: proposal.id, reason },
    })
    return { ok: true, archiveProposed: true }
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
  const { article, body, comments, authorNames, related, role, likeCount, liked, archivePending } =
    loaderData
  const canEdit = role !== 'viewer'
  const isArchived = article.frontmatter.status === 'archived'
  // action 後は最新のいいね状態を反映する
  const likeState = actionData?.like ?? { liked, count: likeCount }
  // コメント返信は dialogue(ミミー)が担当する
  const agentProfile = getAgentProfile('dialogue')
  const tz = useTimezone()
  return (
    <article className={`max-w-3xl mx-auto p-6 ${isArchived ? 'opacity-75' : ''}`}>
      {isArchived && (
        <div className="mb-4 flex items-center gap-2 rounded border border-base-300 bg-base-200 px-3 py-2 text-sm text-base-content/70">
          <span>📦</span>
          <span>この記事はアーカイブされています。最新性は保証されません。</span>
        </div>
      )}
      <h1 className="text-3xl font-bold mb-1">{article.frontmatter.title}</h1>
      <div className="text-xs text-base-content/60 mb-6 flex items-center gap-2 flex-wrap">
        <span>最終更新: {formatDateTime(article.frontmatter.updated_at, tz)}</span>
        <FreshnessBadge rank={article.frontmatter.freshness_rank} />
        {isArchived && (
          <span className="rounded-full bg-base-300 px-2 py-0.5 text-base-content/70">
            📦 アーカイブ済み
          </span>
        )}
        {!isArchived && archivePending && (
          <span className="rounded-full bg-warning/15 px-2 py-0.5 text-warning">
            アーカイブ承認待ち
          </span>
        )}
        {canEdit && isArchived && (
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="unarchive" />
            <button type="submit" className="text-xs bg-secondary text-white px-2 py-1 rounded">
              アーカイブ解除
            </button>
          </Form>
        )}
        {canEdit && !isArchived && !archivePending && (
          <Form method="post" className="inline">
            <input type="hidden" name="intent" value="archive" />
            <button
              type="submit"
              className="text-xs border border-base-300 px-2 py-1 rounded hover:border-warning hover:text-warning"
              title="承認後にアーカイブされます(admin の承認が必要)"
            >
              アーカイブ化
            </button>
          </Form>
        )}
      </div>
      {actionData?.archiveProposed && (
        <p className="mb-4 text-sm text-success">
          アーカイブを申請しました。admin の承認後にアーカイブされます。
        </p>
      )}
      {article.frontmatter.summary && (
        <div className="bg-base-300 p-3 rounded mb-6 text-sm">{article.frontmatter.summary}</div>
      )}
      <div className="mb-6">
        <Form method="post" className="inline">
          <input type="hidden" name="intent" value="toggle_like" />
          <button
            type="submit"
            aria-pressed={likeState.liked}
            className={`inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full border transition-colors ${
              likeState.liked
                ? 'bg-primary/10 border-primary text-primary'
                : 'border-base-300 text-base-content/70 hover:border-primary/50'
            }`}
            title="この記事が役に立ったらいいねを送ろう"
          >
            <span>{likeState.liked ? '♥' : '♡'}</span>
            <span>いいね</span>
            <span className="font-medium">{likeState.count}</span>
          </button>
        </Form>
      </div>
      <ArticleMarkdown source={body} />
      {article.frontmatter.sources.length > 0 && (
        <section className="mt-8 border-t pt-4">
          <h2 className="text-lg font-bold mb-2">出典</h2>
          <ul className="space-y-1 text-sm">
            {article.frontmatter.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} className="text-primary hover:underline">
                  {s.url}
                </a>
                <span className="text-base-content/60 ml-2">
                  取得: {formatDateTime(s.fetched_at, tz)}
                </span>
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
                <a href={articleHref(r.slug)} className="text-primary hover:underline">
                  {r.title}
                </a>
                {r.status === 'archived' && (
                  <span className="ml-2 text-xs text-base-content/60">(archived)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-8 border-t pt-4">
        <h2 className="text-lg font-bold mb-2">コメント</h2>
        <ul className="space-y-4">
          {comments.map((c) => {
            const authorName = authorNames[c.author_id] ?? c.author_id
            return (
              <li
                key={c.id}
                className={`bg-canvas p-3 rounded ${c.status === 'resolved' ? 'opacity-50' : ''}`}
              >
                {/* ユーザーコメント */}
                <div className="flex items-start gap-2">
                  <UserAvatar email={authorName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-base-content/60">
                      <span className="font-medium text-base-content/80">{authorName}</span> -{' '}
                      {formatDateTime(c.created_at, tz)}
                      {c.anchor && <> / @{c.anchor}</>}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{c.body}</p>
                  </div>
                </div>

                {/* dialogue(ミミー)からの返信 */}
                {c.agent_reply && (
                  <div className="flex items-start gap-2 mt-3 ml-6 border-l-2 border-base-300 pl-3">
                    <Avatar profile={agentProfile} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-base-content/60">
                        <span className="font-medium text-base-content/80">
                          {agentProfile.displayName}
                        </span>
                        {c.agent_replied_at && <> - {formatDateTime(c.agent_replied_at, tz)}</>}
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{c.agent_reply}</p>
                    </div>
                  </div>
                )}

                {canEdit && c.status === 'open' && (
                  <Form method="post" className="inline">
                    <input type="hidden" name="intent" value="resolve" />
                    <input type="hidden" name="comment_id" value={c.id} />
                    <button type="submit" className="text-xs text-primary hover:underline mt-2">
                      解決済みにする
                    </button>
                  </Form>
                )}
              </li>
            )
          })}
          {comments.length === 0 && (
            <p className="text-xs text-base-content/60">コメントはまだありません。</p>
          )}
        </ul>
        {canEdit && (
          <Form method="post" className="mt-4 space-y-2 bg-surface p-3 rounded border">
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
            <label className="flex items-center gap-1 text-xs text-base-content/60">
              <input type="checkbox" name="request_research" />
              追加調査タスクとしてキューに投入する
            </label>
            {actionData?.error && <p className="text-error text-xs">{actionData.error}</p>}
            {actionData?.ok && <p className="text-success text-xs">登録しました</p>}
            <button type="submit" className="btn btn-primary btn-sm">
              コメントを追加
            </button>
          </Form>
        )}
      </section>
    </article>
  )
}
