import { describe, expect, test } from 'bun:test'
import { AuthService } from '../src/auth/index.ts'
import { openTestDb } from '../src/db/index.ts'

describe('AuthService', () => {
  test('初回セットアップ → ログイン → セッション再解決', async () => {
    const db = openTestDb()
    const auth = new AuthService(db)
    expect(auth.isInitialSetup()).toBe(true)
    const admin = await auth.createAdminInitial('admin@example.com', 'p@ssw0rd!')
    expect(admin.role).toBe('admin')
    expect(auth.isInitialSetup()).toBe(false)

    const ok = await auth.verifyPassword('admin@example.com', 'p@ssw0rd!')
    expect(ok?.id).toBe(admin.id)
    const ng = await auth.verifyPassword('admin@example.com', 'wrong')
    expect(ng).toBeNull()

    const session = auth.createSession(admin.id)
    const me = auth.resolveSession(session.token)
    expect(me?.email).toBe('admin@example.com')
    auth.deleteSession(session.id)
    expect(auth.resolveSession(session.token)).toBeNull()
    db.close()
  })

  test('招待 → 受諾 → 受諾後は使えない', async () => {
    const db = openTestDb()
    const auth = new AuthService(db)
    const admin = await auth.createAdminInitial('a@x', 'p1')
    const inv = auth.createInvitation({ email: 'b@x', role: 'editor', invited_by: admin.id })
    const editor = await auth.redeemInvitation(inv.token, 'p2')
    expect(editor.role).toBe('editor')
    await expect(auth.redeemInvitation(inv.token, 'p3')).rejects.toThrow()
    db.close()
  })

  test('updateRole: 通常のロール変更ができる', async () => {
    const db = openTestDb()
    const auth = new AuthService(db)
    const admin = await auth.createAdminInitial('a@x', 'p1')
    const inv = auth.createInvitation({ email: 'b@x', role: 'viewer', invited_by: admin.id })
    const target = await auth.redeemInvitation(inv.token, 'p2')
    const updated = auth.updateRole({
      user_id: target.id,
      role: 'editor',
      actor_user_id: admin.id,
    })
    expect(updated.role).toBe('editor')
    db.close()
  })

  test('updateRole: 自分自身の admin 降格は拒否される', async () => {
    const db = openTestDb()
    const auth = new AuthService(db)
    const admin = await auth.createAdminInitial('a@x', 'p1')
    expect(() =>
      auth.updateRole({ user_id: admin.id, role: 'editor', actor_user_id: admin.id }),
    ).toThrow(/Cannot demote yourself/)
    db.close()
  })

  test('updateRole: 最後の admin の降格は拒否される(別ユーザーから操作しても)', async () => {
    const db = openTestDb()
    const auth = new AuthService(db)
    const admin = await auth.createAdminInitial('a@x', 'p1')
    // ロール変更の actor を別 admin にしても、対象が「最後の admin」だと拒否される
    // ここでは admin が 1 人だけのまま、別 actor から呼んで last_admin を期待
    expect(() =>
      auth.updateRole({ user_id: admin.id, role: 'editor', actor_user_id: 'someone-else' }),
    ).toThrow(/last admin/)
    db.close()
  })
})
