import { Form, redirect } from 'react-router'
import { detectLocale, getDict, useDict } from '../i18n/index.ts'
import { assertSameOrigin, serializeSession } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/setup.ts'

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  const services = getServices()
  if (!services.auth.isInitialSetup()) throw redirect('/')
  const form = await request.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  if (!email || password.length < 8)
    return { error: getDict(detectLocale(request)).setup.errorInvalid }
  const admin = await services.auth.createAdminInitial(email, password)
  const session = services.auth.createSession(admin.id)
  return redirect('/', { headers: { 'Set-Cookie': serializeSession(session.token) } })
}

export default function Setup({ actionData }: Route.ComponentProps) {
  const t = useDict()
  const error = actionData?.error
  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">{t.setup.title}</h1>
      <p className="text-sm text-base-content/60 mb-6">{t.setup.description}</p>
      <Form method="post" className="space-y-3">
        <input
          name="email"
          type="email"
          required
          className="w-full px-3 py-2 border rounded"
          placeholder="admin@example.com"
        />
        <input
          name="password"
          type="password"
          required
          minLength={8}
          className="w-full px-3 py-2 border rounded"
          placeholder={t.setup.passwordPlaceholder}
        />
        {error && <p className="text-error text-sm">{error}</p>}
        <button type="submit" className="btn btn-primary w-full">
          {t.setup.submit}
        </button>
      </Form>
    </div>
  )
}
