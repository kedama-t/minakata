import { Form, redirect } from 'react-router'
import { detectLocale, getDict, useDict } from '../i18n/index.ts'
import { assertSameOrigin, serializeSession } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/invitation.ts'

export async function action({ request, params }: Route.ActionArgs) {
  assertSameOrigin(request)
  const form = await request.formData()
  const password = String(form.get('password') ?? '')
  if (password.length < 8)
    return { error: getDict(detectLocale(request)).invitation.errorPasswordTooShort }
  const services = getServices()
  try {
    const user = await services.auth.redeemInvitation(params.token ?? '', password)
    const session = services.auth.createSession(user.id)
    return redirect('/', { headers: { 'Set-Cookie': serializeSession(session.token) } })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'invitation error' }
  }
}

export default function Invitation({ actionData, params }: Route.ComponentProps) {
  const t = useDict()
  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">{t.invitation.title}</h1>
      <p className="text-sm text-base-content/60 mb-4">{t.invitation.description}</p>
      <Form method="post" className="space-y-3">
        <input
          type="password"
          name="password"
          required
          minLength={8}
          className="w-full px-3 py-2 border rounded"
          placeholder={t.invitation.passwordPlaceholder}
        />
        {actionData?.error && <p className="text-error text-sm">{actionData.error}</p>}
        <button type="submit" className="btn btn-primary w-full">
          {t.invitation.submit}
        </button>
      </Form>
      <p className="text-xs text-base-content/60 mt-4">
        {t.invitation.tokenLabel} {params.token}
      </p>
    </div>
  )
}
