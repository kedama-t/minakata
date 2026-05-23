import { Form, redirect } from 'react-router'
import { serializeSession } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/invitation.ts'

export async function action({ request, params }: Route.ActionArgs) {
  const form = await request.formData()
  const password = String(form.get('password') ?? '')
  if (password.length < 8) return { error: 'パスワードは 8 文字以上' }
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
  return (
    <div className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">招待を受諾</h1>
      <p className="text-sm text-slate-600 mb-4">パスワードを設定してアカウントを有効化します。</p>
      <Form method="post" className="space-y-3">
        <input
          type="password"
          name="password"
          required
          minLength={8}
          className="w-full px-3 py-2 border rounded"
          placeholder="パスワード(8 文字以上)"
        />
        {actionData?.error && <p className="text-red-600 text-sm">{actionData.error}</p>}
        <button type="submit" className="w-full bg-blue-600 text-white py-2 rounded">
          有効化
        </button>
      </Form>
      <p className="text-xs text-slate-500 mt-4">招待トークン: {params.token}</p>
    </div>
  )
}
