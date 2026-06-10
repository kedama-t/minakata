import { Form } from 'react-router'
import { InfoIcon } from '../components/icons.tsx'
import { useDict } from '../i18n/index.ts'
import { assertSameOrigin, requireAdmin } from '../lib/auth.ts'
import { formatDateTime, useTimezone } from '../lib/date.ts'
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
  const t = useDict()
  const tz = useTimezone()
  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-3">{t.policy.title}</h1>
      <div role="alert" className="alert alert-info alert-soft mb-4">
        <InfoIcon />
        <span className="text-sm">{t.policy.description}</span>
      </div>
      <Form method="post">
        <div className="card card-border bg-surface">
          <div className="card-body gap-3">
            <textarea
              name="body_md"
              defaultValue={loaderData.policy.body_md}
              rows={18}
              className="textarea w-full font-mono text-sm"
              placeholder={t.policy.placeholder}
            />
            <div className="card-actions items-center">
              <button type="submit" className="btn btn-primary btn-sm">
                {t.common.save}
              </button>
              {actionData?.ok && <span className="text-success text-sm">{t.common.saved}</span>}
              <span className="text-xs text-base-content/60 ml-auto">
                {t.common.lastUpdated}: {formatDateTime(loaderData.policy.updated_at, tz)}
              </span>
            </div>
          </div>
        </div>
      </Form>
    </div>
  )
}
