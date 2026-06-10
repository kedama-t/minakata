import { Form } from 'react-router'
import { InfoIcon } from '../components/icons.tsx'
import { useDict } from '../i18n/index.ts'
import { articleHref } from '../lib/article-link.ts'
import { assertSameOrigin, requireEditor } from '../lib/auth.ts'
import { formatDateTime, useTimezone } from '../lib/date.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/insights.ts'

export async function loader({ request }: Route.LoaderArgs) {
  requireEditor(request)
  const services = getServices()
  return {
    insights: services.feedback.getInsights(),
    signals: services.feedback.signals({ limit: 10 }),
  }
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  const editor = requireEditor(request)
  const form = await request.formData()
  const body = String(form.get('body_md') ?? '')
  getServices().feedback.updateInsights(body, `user:${editor.id}`)
  return { ok: true }
}

export default function Insights({ loaderData, actionData }: Route.ComponentProps) {
  const t = useDict()
  const { insights, signals } = loaderData
  const tz = useTimezone()
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <section>
        <h1 className="text-2xl font-bold mb-3">{t.insights.title}</h1>
        <div role="alert" className="alert alert-info alert-soft mb-4">
          <InfoIcon />
          <span className="text-sm">{t.insights.description}</span>
        </div>
        <Form method="post">
          <div className="card card-border bg-surface">
            <div className="card-body gap-3">
              <textarea
                name="body_md"
                defaultValue={insights.body_md}
                rows={16}
                className="textarea w-full font-mono text-sm"
                placeholder={t.insights.placeholder}
              />
              <div className="card-actions items-center">
                <button type="submit" className="btn btn-primary btn-sm">
                  {t.common.save}
                </button>
                {actionData?.ok && <span className="text-success text-sm">{t.common.saved}</span>}
                <span className="text-xs text-base-content/60 ml-auto">
                  {t.common.lastUpdated}: {formatDateTime(insights.updated_at, tz)}
                  {insights.updated_by && <> / {insights.updated_by}</>}
                </span>
              </div>
            </div>
          </div>
        </Form>
      </section>

      <section>
        <div className="stats bg-surface border border-border mb-4">
          <div className="stat">
            <div className="stat-title">{t.insights.totalLikes}</div>
            <div className="stat-value text-primary">{signals.total_likes}</div>
            <div className="stat-desc">{t.insights.totalLikesDesc}</div>
          </div>
        </div>
        <h2 className="text-lg font-bold mb-2">{t.insights.rankingTitle}</h2>
        {signals.top_liked.length === 0 ? (
          <div role="alert" className="alert alert-soft">
            <span className="text-sm">{t.insights.rankingEmpty}</span>
          </div>
        ) : (
          <ul className="space-y-1 text-sm">
            {signals.top_liked.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="text-primary tabular-nums w-10">♥ {a.like_count}</span>
                <a href={articleHref(a.slug)} className="text-primary hover:underline truncate">
                  {a.title}
                </a>
                {a.comment_count > 0 && (
                  <span className="text-xs text-base-content/50">💬 {a.comment_count}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
