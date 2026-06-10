import { Form } from 'react-router'
import { InfoIcon } from '../components/icons.tsx'
import { detectLocale, getDict, useDict } from '../i18n/index.ts'
import { articleHref } from '../lib/article-link.ts'
import { assertSameOrigin, requireAdmin } from '../lib/auth.ts'
import { formatDateTime, useTimezone } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/archives.ts'

export async function loader({ request }: Route.LoaderArgs) {
  requireAdmin(request)
  const t = getDict(detectLocale(request))
  const services = getServices()
  const proposals = services.archives.list('proposed').map((p) => {
    const a = services.articles.read(p.article_id)
    return {
      ...p,
      article_title: a?.frontmatter.title ?? t.common.deleted,
      article_slug: a?.frontmatter.slug ?? null,
    }
  })
  return { proposals }
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  const admin = requireAdmin(request)
  const t = getDict(detectLocale(request))
  const services = getServices()
  const form = await request.formData()
  const intent = String(form.get('intent') ?? '')
  const proposalId = String(form.get('proposal_id') ?? '')
  if (!proposalId) return { error: t.archives.errorProposalIdRequired }
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
    if (!reason) return { error: t.archives.errorReasonRequired }
    await services.archives.reject(proposalId, admin.id, reason)
    services.audit.log({
      actor: `user:${admin.id}`,
      tool_name: 'web.reject_archive',
      metadata: { proposal_id: proposalId, reason },
    })
    return { ok: 'rejected' }
  }
  return { error: t.common.unknownIntent }
}

export default function Archives({ loaderData, actionData }: Route.ComponentProps) {
  const t = useDict()
  const { proposals } = loaderData
  const tz = useTimezone()
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">{t.archives.title}</h1>
      <div role="alert" className="alert alert-info alert-soft">
        <InfoIcon />
        <span className="text-sm">{t.archives.description}</span>
      </div>
      {actionData?.ok && (
        <div role="alert" className="alert alert-success alert-soft">
          <span className="text-sm">
            {actionData.ok === 'approved' ? t.archives.approved : t.archives.rejected}
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
          <span className="text-sm">{t.archives.empty}</span>
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
                      href={articleHref(p.article_slug)}
                      className="text-primary font-semibold hover:underline truncate"
                    >
                      {p.article_title}
                    </a>
                  ) : (
                    <span className="font-semibold truncate">{p.article_title}</span>
                  )}
                </div>
                <span className="text-xs text-base-content/60 shrink-0">
                  {formatDateTime(p.created_at, tz)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="badge badge-ghost badge-sm">{t.archives.proposedBy}</span>
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
                    {t.archives.approveArchive}
                  </button>
                </Form>
                <Form method="post" className="flex gap-2 flex-1">
                  <input type="hidden" name="proposal_id" value={p.id} />
                  <input
                    name="reason"
                    required
                    className="input input-sm flex-1"
                    placeholder={t.archives.rejectPlaceholder}
                  />
                  <button
                    type="submit"
                    name="intent"
                    value="reject"
                    className="btn btn-neutral btn-sm"
                  >
                    {t.archives.reject}
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
