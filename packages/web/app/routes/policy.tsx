import { Form } from 'react-router'
import { InfoIcon } from '../components/icons.tsx'
import { assertSameOrigin, requireAdmin } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/policy.ts'

export async function loader({ request }: Route.LoaderArgs) {
  requireAdmin(request)
  return { policy: getServices().policy.get() }
}

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  const admin = requireAdmin(request)
  const form = await request.formData()
  const body = String(form.get('body_md') ?? '')
  getServices().policy.update(body, admin.id)
  return { ok: true }
}

export default function Policy({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-3">リサーチ方針</h1>
      <div role="alert" className="alert alert-info alert-soft mb-4">
        <InfoIcon />
        <span className="text-sm">
          調査エージェントが記事を書くときに従う方針です。優先して参照するソース、調査の粒度、記事に必ず含める項目(出典・TL;DR
          など)を Markdown で記述してください。
        </span>
      </div>
      <Form method="post">
        <div className="card card-border bg-surface">
          <div className="card-body gap-3">
            <textarea
              name="body_md"
              defaultValue={loaderData.policy.body_md}
              rows={18}
              className="textarea w-full font-mono text-sm"
              placeholder="# リサーチ方針&#10;..."
            />
            <div className="card-actions items-center">
              <button type="submit" className="btn btn-primary btn-sm">
                保存
              </button>
              {actionData?.ok && <span className="text-success text-sm">保存しました</span>}
              <span className="text-xs text-base-content/60 ml-auto">
                最終更新: {loaderData.policy.updated_at}
              </span>
            </div>
          </div>
        </div>
      </Form>
    </div>
  )
}
