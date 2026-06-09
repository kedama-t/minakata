import { Form } from 'react-router'
import { InfoIcon } from '../components/icons.tsx'
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
  const { insights, signals } = loaderData
  const tz = useTimezone()
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <section>
        <h1 className="text-2xl font-bold mb-3">執筆インサイト</h1>
        <div role="alert" className="alert alert-info alert-soft mb-4">
          <InfoIcon />
          <span className="text-sm">
            読者のいいねやコメントの傾向を分析して蓄積する、記事執筆の指針です。feedback_analyst
            エージェントが自動で更新し、記事を書くエージェントが執筆時に参照します。内容はここから手動でも編集できます。
          </span>
        </div>
        <Form method="post">
          <div className="card card-border bg-surface">
            <div className="card-body gap-3">
              <textarea
                name="body_md"
                defaultValue={insights.body_md}
                rows={16}
                className="textarea w-full font-mono text-sm"
                placeholder="# 執筆インサイト&#10;- いいねが付きやすい記事の傾向..."
              />
              <div className="card-actions items-center">
                <button type="submit" className="btn btn-primary btn-sm">
                  保存
                </button>
                {actionData?.ok && <span className="text-success text-sm">保存しました</span>}
                <span className="text-xs text-base-content/60 ml-auto">
                  最終更新: {formatDateTime(insights.updated_at, tz)}
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
            <div className="stat-title">累計いいね</div>
            <div className="stat-value text-primary">{signals.total_likes}</div>
            <div className="stat-desc">いいねが付いた記事のランキングを下に表示します</div>
          </div>
        </div>
        <h2 className="text-lg font-bold mb-2">いいねランキング</h2>
        {signals.top_liked.length === 0 ? (
          <div role="alert" className="alert alert-soft">
            <span className="text-sm">まだいいねの付いた記事はありません。</span>
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
