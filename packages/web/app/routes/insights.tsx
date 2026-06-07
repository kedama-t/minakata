import { Form } from 'react-router'
import { assertSameOrigin, requireEditor } from '../lib/auth.ts'
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
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <section>
        <h1 className="text-2xl font-bold mb-2">執筆インサイト</h1>
        <p className="text-sm text-base-content/60 mb-4">
          いいね/コメントの傾向を分析して蓄積する執筆指針。feedback_analyst
          が自動更新し、執筆系エージェントが system prompt
          に挿入する。人間が手で修正することもできる。
        </p>
        <Form method="post" className="space-y-2">
          <textarea
            name="body_md"
            defaultValue={insights.body_md}
            rows={16}
            className="w-full px-3 py-2 border rounded font-mono text-sm"
            placeholder="# 執筆インサイト&#10;- いいねが付きやすい記事の傾向..."
          />
          <div className="flex gap-3 items-center">
            <button type="submit" className="btn btn-primary btn-sm">
              保存
            </button>
            {actionData?.ok && <span className="text-success text-sm">保存しました</span>}
            <span className="text-xs text-base-content/60 ml-auto">
              最終更新: {insights.updated_at}
              {insights.updated_by && <> / {insights.updated_by}</>}
            </span>
          </div>
        </Form>
      </section>

      <section>
        <h2 className="text-lg font-bold mb-2">
          いいねランキング
          <span className="ml-2 text-xs font-normal text-base-content/60">
            累計いいね {signals.total_likes}
          </span>
        </h2>
        {signals.top_liked.length === 0 ? (
          <p className="text-sm text-base-content/60">まだいいねの付いた記事はありません。</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {signals.top_liked.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <span className="text-primary tabular-nums w-10">♥ {a.like_count}</span>
                <a href={`/articles/${a.slug}`} className="text-primary hover:underline truncate">
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
