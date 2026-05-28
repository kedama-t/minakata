import { Form, redirect } from 'react-router'
import { serializeSession } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/login.ts'

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData()
  const email = String(form.get('email') ?? '')
  const password = String(form.get('password') ?? '')
  const services = getServices()
  const user = await services.auth.verifyPassword(email, password)
  if (!user) return { error: 'メールまたはパスワードが正しくありません' }
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
        {actionData?.error && (
          <p className="text-red-600 dark:text-red-400 text-sm">{actionData.error}</p>
        )}
        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded">
          ログイン
        </button>
      </Form>
      <p className="text-xs text-slate-500 dark:text-slate-400 dark:text-slate-500 mt-4">
        新規ユーザーは管理者の招待リンクから登録できます。
      </p>
    </div>
  )
}
