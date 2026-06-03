import { Form } from 'react-router'
import { assertSameOrigin, requireAdmin } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/archives.ts'

export async function loader({ request }: Route.LoaderArgs) {
  requireAdmin(request)
  const services = getServices()
  const proposals = services.archives.list('proposed').map((p) => {
    const a = services.articles.read(p.article_id)
    return {
      ...p,
      article_title: a?.frontmatter.title ?? '(削除済み)',
      article_slug: a?.frontmatter.slug ?? null,
    }
  })
  return { proposals }
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  const admin = requireAdmin(request)
  const services = getServices()
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const proposalId = String(form.get('proposal_id') ?? '')
  if (!proposalId) return { error: 'proposal_id が無い' }
  if (intent === 'approve') {
    await services.archives.approve(proposalId, admin.id)
    services.audit.log({
      actor: `user:${admin.id}`,
      tool_name: 'web.approve_archive',
      metadata: { proposal_id: proposalId },
    })
    return { ok: 'approved' }
  }
  if (intent === 'reject') {
    const reason = String(form.get('reason') ?? '').trim()
    if (!reason) return { error: '却下理由が必要' }
    services.archives.reject(proposalId, admin.id, reason)
    services.audit.log({
      actor: `user:${admin.id}`,
      tool_name: 'web.reject_archive',
      metadata: { proposal_id: proposalId, reason },
    })
    return { ok: 'rejected' }
  }
  return { error: 'unknown intent' }
}

export default function Archives({ loaderData, actionData }: Route.ComponentProps) {
  const { proposals } = loaderData
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">アーカイブ承認待ち</h1>
      <p className="text-sm text-base-content/60">
        エージェントが提案したアーカイブはここで admin が承認/却下する(§6
        承認ゲート)。承認するまで記事は `archived` にならない。
      </p>
      {actionData?.ok && (
        <p className="text-success text-sm">
          {actionData.ok === 'approved' ? '承認しました' : '却下しました'}
        </p>
      )}
      {actionData?.error && <p className="text-error text-sm">{actionData.error}</p>}
      {proposals.length === 0 && (
        <p className="text-sm text-base-content/60">承認待ちのアーカイブ提案はありません。</p>
      )}
      <ul className="space-y-3">
        {proposals.map((p) => (
          <li key={p.id} className="bg-surface border rounded p-4 space-y-2">
            <div className="flex items-center justify-between">
              {p.article_slug ? (
                <a
                  href={`/articles/${p.article_slug}`}
                  className="text-primary font-semibold hover:underline"
                >
                  {p.article_title}
                </a>
              ) : (
                <span className="font-semibold">{p.article_title}</span>
              )}
              <span className="text-xs text-base-content/60">{p.created_at}</span>
            </div>
            <p className="text-xs text-base-content/60">提案者: {p.proposed_by}</p>
            {p.reason && (
              <p className="text-sm text-base-content/80 bg-canvas rounded p-2">{p.reason}</p>
            )}
            <div className="flex gap-2 items-start">
              <Form method="post" className="inline">
                <input type="hidden" name="proposal_id" value={p.id} />
                <button
                  type="submit"
                  name="intent"
                  value="approve"
                  className="btn btn-error btn-sm"
                >
                  アーカイブを承認
                </button>
              </Form>
              <Form method="post" className="flex gap-2 flex-1">
                <input type="hidden" name="proposal_id" value={p.id} />
                <input
                  name="reason"
                  required
                  className="flex-1 px-2 py-1 border rounded text-sm"
                  placeholder="却下理由(差し戻し時必須)"
                />
                <button
                  type="submit"
                  name="intent"
                  value="reject"
                  className="btn btn-neutral btn-sm"
                >
                  却下
                </button>
              </Form>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
