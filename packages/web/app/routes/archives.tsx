import { Form } from 'react-router'
import { InfoIcon } from '../components/icons.tsx'
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
      <div role="alert" className="alert alert-info alert-soft">
        <InfoIcon />
        <span className="text-sm">
          記事のアーカイブにはadminの承認が必要です。エージェントから提案されたアーカイブがここに並びます。内容を確認して、承認するか、理由を添えて却下(差し戻し)してください。
        </span>
      </div>
      {actionData?.ok && (
        <div role="alert" className="alert alert-success alert-soft">
          <span className="text-sm">
            {actionData.ok === 'approved' ? '承認しました' : '却下しました'}
          </span>
        </div>
      )}
      {actionData?.error && (
        <div role="alert" className="alert alert-error alert-soft">
          <span className="text-sm">{actionData.error}</span>
        </div>
      )}
      {proposals.length === 0 && (
        <div role="alert" className="alert alert-soft">
          <span className="text-sm">承認待ちのアーカイブ提案はありません。</span>
        </div>
      )}
      <ul className="space-y-3">
        {proposals.map((p) => (
          <li key={p.id} className="card card-border bg-surface">
            <div className="card-body gap-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {p.article_slug ? (
                    <a
                      href={`/articles/${p.article_slug}`}
                      className="text-primary font-semibold hover:underline truncate"
                    >
                      {p.article_title}
                    </a>
                  ) : (
                    <span className="font-semibold truncate">{p.article_title}</span>
                  )}
                </div>
                <span className="text-xs text-base-content/60 shrink-0">{p.created_at}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge badge-ghost badge-sm">提案者</span>
                <span className="text-xs text-base-content/60">{p.proposed_by}</span>
              </div>
              {p.reason && (
                <p className="text-sm text-base-content/80 bg-canvas rounded p-2">{p.reason}</p>
              )}
              <div className="card-actions items-start">
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
                    className="input input-sm flex-1"
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
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
