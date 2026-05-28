import { AuthError, RoleSchema } from '@minakata/core'
import { Form } from 'react-router'
import { requireAdmin } from '../lib/auth.ts'
import { getServices } from '../lib/services.ts'
import type { Route } from './+types/members.ts'

interface RawMember {
  id: string
  email: string
  role: string
  created_at: string
}

interface RawInvite {
  id: string
  email: string
  role: string
  token: string
  expires_at: string
  used_at: string | null
}

export async function loader({ request }: Route.LoaderArgs) {
  const admin = requireAdmin(request)
  const { db } = getServices()
  const members = db
    .query<RawMember, []>('SELECT id, email, role, created_at FROM users ORDER BY created_at')
    .all()
  const invitations = db
    .query<RawInvite, []>(
      'SELECT id, email, role, token, expires_at, used_at FROM invitations WHERE used_at IS NULL ORDER BY created_at DESC',
    )
    .all()
  return { members, invitations, currentUserId: admin.id }
}

export async function action({ request }: Route.ActionArgs) {
  const admin = requireAdmin(request)
  const services = getServices()
  const form = await request.formData()
  const intent = String(form.get('intent') ?? 'invite')

  if (intent === 'update_role') {
    const userId = String(form.get('user_id') ?? '')
    const role = RoleSchema.parse(String(form.get('role') ?? ''))
    if (!userId) return { error: 'user_id が必要' }
    try {
      const updated = services.auth.updateRole({
        user_id: userId,
        role,
        actor_user_id: admin.id,
      })
      services.audit.log({
        actor: `user:${admin.id}`,
        tool_name: 'web.update_role',
        metadata: { target_user_id: userId, new_role: updated.role },
      })
      return { roleUpdated: { id: updated.id, role: updated.role } }
    } catch (err) {
      if (err instanceof AuthError) {
        const map: Record<string, string> = {
          self_demote: '自分自身の admin を降格することはできません',
          last_admin: '最後の admin を降格することはできません',
          not_found: 'ユーザーが見つかりません',
        }
        return { error: map[err.code] ?? err.message }
      }
      throw err
    }
  }

  // 既定: 招待発行
  const email = String(form.get('email') ?? '').trim()
  const role = RoleSchema.parse(String(form.get('role') ?? 'editor'))
  if (!email) return { error: 'メールアドレスが必要' }
  const inv = services.auth.createInvitation({ email, role, invited_by: admin.id })
  return { invitation: inv }
}

export default function Members({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">メンバー管理</h1>

      <section className="bg-white dark:bg-slate-800 p-4 rounded border">
        <h2 className="text-lg font-bold mb-2">招待を発行</h2>
        <Form method="post" className="flex gap-2 items-end">
          <input
            name="email"
            type="email"
            required
            className="flex-1 px-3 py-2 border rounded"
            placeholder="email"
          />
          <select name="role" defaultValue="editor" className="px-3 py-2 border rounded">
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
            <option value="admin">admin</option>
          </select>
          <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded">
            招待
          </button>
        </Form>
        {actionData?.error && (
          <p className="text-red-600 dark:text-red-400 text-sm mt-2">{actionData.error}</p>
        )}
        {actionData?.invitation && (
          <p className="text-sm text-green-700 dark:text-green-300 mt-2">
            招待リンク:
            <code className="ml-1 bg-slate-100 dark:bg-slate-700 px-1">
              /invitations/{actionData.invitation.token}
            </code>
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-bold mb-2">メンバー一覧</h2>
        {actionData?.roleUpdated && (
          <p className="text-green-700 dark:text-green-300 text-sm mb-2">
            ロールを {actionData.roleUpdated.role} に変更しました
          </p>
        )}
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500 dark:text-slate-400 dark:text-slate-500">
            <tr>
              <th className="py-1">email</th>
              <th>role</th>
              <th>created</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {loaderData.members.map((m) => {
              const isSelf = m.id === loaderData.currentUserId
              return (
                <tr key={m.id} className="border-t">
                  <td className="py-1">
                    {m.email}
                    {isSelf && (
                      <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">
                        (自分)
                      </span>
                    )}
                  </td>
                  <td>{m.role}</td>
                  <td className="text-slate-500 dark:text-slate-400 dark:text-slate-500">
                    {m.created_at}
                  </td>
                  <td>
                    <Form method="post" className="flex gap-1 items-center">
                      <input type="hidden" name="intent" value="update_role" />
                      <input type="hidden" name="user_id" value={m.id} />
                      <select
                        name="role"
                        defaultValue={m.role}
                        className="px-2 py-0.5 border rounded text-xs"
                      >
                        <option value="viewer">viewer</option>
                        <option value="editor">editor</option>
                        <option value="admin">admin</option>
                      </select>
                      <button
                        type="submit"
                        className="text-xs bg-slate-600 text-white px-2 py-0.5 rounded"
                      >
                        変更
                      </button>
                    </Form>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-bold mb-2">未受諾の招待</h2>
        {loaderData.invitations.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400 dark:text-slate-500">
            未受諾の招待はありません
          </p>
        )}
        <ul className="space-y-1 text-sm">
          {loaderData.invitations.map((i) => (
            <li key={i.id} className="border-b py-1">
              <span className="font-semibold">{i.email}</span>
              <span className="ml-2 text-slate-500 dark:text-slate-400 dark:text-slate-500">
                {i.role}
              </span>
              <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                期限: {i.expires_at}
              </span>
              <code className="ml-2 bg-slate-100 dark:bg-slate-700 px-1 text-xs">
                /invitations/{i.token}
              </code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
