import { Form } from 'react-router'
import { requireAdmin } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/policy.ts'

export async function loader({ request }: Route.LoaderArgs) {
  requireAdmin(request)
  return { policy: getServices().policy.get() }
}

export async function action({ request }: Route.ActionArgs) {
  const admin = requireAdmin(request)
  const form = await request.formData()
  const body = String(form.get('body_md') ?? '')
  getServices().policy.update(body, admin.id)
  return { ok: true }
}

export default function Policy({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-2">リサーチ方針</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 dark:text-slate-500 mb-4">
        Hermes の subagent が system prompt に挿入する
        Markdown。優先ソース・粒度・必須項目(出典/TL;DR 等)を書く。
      </p>
      <Form method="post" className="space-y-2">
        <textarea
          name="body_md"
          defaultValue={loaderData.policy.body_md}
          rows={18}
          className="w-full px-3 py-2 border rounded font-mono text-sm"
          placeholder="# リサーチ方針&#10;..."
        />
        <div className="flex gap-3 items-center">
          <button type="submit" className="btn btn-primary btn-sm">
            保存
          </button>
          {actionData?.ok && (
            <span className="text-green-600 dark:text-green-400 text-sm">保存しました</span>
          )}
          <span className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500 ml-auto">
            最終更新: {loaderData.policy.updated_at}
          </span>
        </div>
      </Form>
    </div>
  )
}
