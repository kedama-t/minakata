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
})
