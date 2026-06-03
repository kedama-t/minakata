import { Form } from 'react-router'
import { assertSameOrigin, requireAdmin } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/skills.ts'

export async function loader({ request }: Route.LoaderArgs) {
  requireAdmin(request)
  const all = getServices().skills.list()
  return { proposals: all }
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  const admin = requireAdmin(request)
  const services = getServices()
  const form = await request.formData()
  const id = String(form.get('id') ?? '')
  const intent = String(form.get('intent') ?? '')
  if (intent === 'approve') {
    const r = services.skills.approve(id, admin.id)
    return { approved: r.written_to }
  }
  if (intent === 'reject') {
    services.skills.reject(id, admin.id)
    return { rejected: id }
  }
  return { error: 'unknown intent' }
}

export default function Skills({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">スキル提案レビュー</h1>
      {actionData?.approved && (
        <p className="text-sm text-success">承認しました(書き込み先: {actionData.approved})</p>
      )}
      {actionData?.rejected && <p className="text-sm text-warning">却下しました</p>}
      <ul className="space-y-3">
        {loaderData.proposals.map((p) => (
          <li key={p.id} className="bg-surface p-4 rounded border">
            <div className="flex items-center justify-between">
              <h2 className="font-bold">
                {p.name}{' '}
                <span
                  className={`ml-2 text-xs px-2 py-0.5 rounded ${
                    p.status === 'proposed'
                      ? 'bg-primary/15 text-primary'
                      : p.status === 'approved'
                        ? 'bg-success/15 text-success'
                        : 'bg-base-300 text-base-content/60'
                  }`}
                >
                  {p.status}
                </span>
              </h2>
              <span className="text-xs text-base-content/60">{p.created_at}</span>
            </div>
            <p className="text-sm text-base-content/60 mt-1">{p.description}</p>
            <details className="mt-2">
              <summary className="text-xs text-primary cursor-pointer">コードを表示</summary>
              <pre className="text-xs bg-canvas p-2 rounded mt-1 whitespace-pre-wrap">{p.code}</pre>
            </details>
            {p.status === 'proposed' && (
              <div className="mt-2 flex gap-2">
                <Form method="post" className="inline">
                  <input type="hidden" name="id" value={p.id} />
                  <button
                    type="submit"
                    name="intent"
                    value="approve"
                    className="btn btn-success btn-sm"
                  >
                    承認して書き出し
                  </button>
                </Form>
                <Form method="post" className="inline">
                  <input type="hidden" name="id" value={p.id} />
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
            )}
          </li>
        ))}
        {loaderData.proposals.length === 0 && (
          <p className="text-sm text-base-content/60">スキル提案はまだありません。</p>
        )}
      </ul>
    </div>
  )
}
