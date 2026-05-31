import { Form, redirect } from 'react-router'
import { serializeSession } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/setup.ts'

export async function action({ request }: Route.ActionArgs) {
  const services = getServices()
  if (!services.auth.isInitialSetup()) throw redirect('/')
  const form = await request.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  if (!email || password.length < 8) return { error: 'メールと 8 文字以上のパスワードが必要' }
  const admin = await services.auth.createAdminInitial(email, password)
  const session = services.auth.createSession(admin.id)
  return redirect('/', { headers: { 'Set-Cookie': serializeSession(session.token) } })
}

export default function Setup({ actionData }: Route.ComponentProps) {
  const error = actionData?.error
  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">初期セットアップ</h1>
      <p className="text-sm text-slate-600 dark:text-slate-400 dark:text-slate-500 mb-6">
        最初の管理者アカウントを作成してください。以後の利用者は招待ベースで追加されます。
      </p>
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
          placeholder="パスワード(8 文字以上)"
        />
        {error && <p className="text-error text-sm">{error}</p>}
        <button type="submit" className="btn btn-primary w-full">
          管理者を作成
        </button>
      </Form>
    </div>
  )
}
