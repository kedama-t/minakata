import { Form, redirect } from 'react-router'
import { assertSameOrigin, serializeSession } from '../lib/auth.ts'
import { serializeSession } from '../lib/auth.ts'
import { isRateLimited, resetRateLimit } from '../lib/rateLimit.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/login.ts'

export async function action({ request }: Route.ActionArgs) {
  assertSameOrigin(request)
  // IP ベースのレート制限(5 分間に 5 回まで)
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  if (isRateLimited(ip)) {
    return { error: 'しばらく時間をおいてから再試行してください' }
  }

  const form = await request.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const services = getServices()
  const user = await services.auth.verifyPassword(email, password)
  if (!user) return { error: 'メールまたはパスワードが正しくありません' }
  resetRateLimit(ip)
  const session = services.auth.createSession(user.id)
  return redirect('/', { headers: { 'Set-Cookie': serializeSession(session.token) } })
}

export default function Login({ actionData }: Route.ComponentProps) {
  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">ログイン</h1>
      <Form method="post" className="space-y-3">
        <input
          name="email"
          type="email"
          required
          className="w-full px-3 py-2 border rounded"
          placeholder="メールアドレス"
        />
        <input
          name="password"
          type="password"
          required
          className="w-full px-3 py-2 border rounded"
          placeholder="パスワード"
        />
        {actionData?.error && <p className="text-error text-sm">{actionData.error}</p>}
        <button type="submit" className="btn btn-primary w-full">
          ログイン
        </button>
      </Form>
      <p className="text-xs text-base-content/60 mt-4">
        新規ユーザーは管理者の招待リンクから登録できます。
      </p>
    </div>
  )
}
