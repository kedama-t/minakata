import { createHash } from 'node:crypto'
import { hash, verify } from '@node-rs/argon2'
import { encodeBase64urlNoPadding } from '@oslojs/encoding'
import type { Db } from '../db/index.ts'
import type { Role } from '../schema/index.ts'
import { newId, now } from '../util/id.ts'

const SESSION_TTL_DAYS = 30
const INVITATION_TTL_DAYS = 7

export interface User {
  id: string
  email: string
  role: Role
  created_at: string
}

export interface Invitation {
  id: string
  email: string
  role: Role
  token: string
  expires_at: string
  used_at: string | null
  invited_by: string
  created_at: string
}

export class AuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * 認証・ユーザー管理・招待・セッション。
 * Cookie に詰めるセッショントークンは不透明な ULID + ランダムシードで、サーバー側の sessions テーブルで検証する。
 */
export class AuthService {
  constructor(private readonly db: Db) {}

  // --- ユーザー / セットアップ ---

  /** 初回管理者作成時のみ true(users が空)。/setup ガードで利用 */
  isInitialSetup(): boolean {
    const row = this.db.query<{ c: number }, []>('SELECT COUNT(*) AS c FROM users').get()
    return (row?.c ?? 0) === 0
  }

  async createAdminInitial(email: string, password: string): Promise<User> {
    if (!this.isInitialSetup()) {
      throw new AuthError('not_initial', 'Initial setup already completed')
    }
    return this.createUser({ email, password, role: 'admin' })
  }

  async createUser(input: { email: string; password: string; role: Role }): Promise<User> {
    const id = newId()
    const password_hash = await hash(input.password)
    const created_at = now()
    this.db
      .prepare(
        'INSERT INTO users (id, email, password_hash, role, created_at) VALUES ($id, $email, $hash, $role, $ts)',
      )
      .run({ id, email: input.email, hash: password_hash, role: input.role, ts: created_at })
    return { id, email: input.email, role: input.role, created_at }
  }

  /**
   * 既存ユーザーのロールを変更する(US-1.2)。
   * - 自分自身を admin から降格しようとした場合は AuthError('self_demote')
   * - 最後の admin を降格しようとした場合は AuthError('last_admin')
   *   (admin が誰も居なくなると承認ゲートが詰まるため)
   */
  updateRole(input: { user_id: string; role: Role; actor_user_id: string }): User {
    const target = this.db
      .query<{ id: string; email: string; role: Role; created_at: string }, [string]>(
        'SELECT id, email, role, created_at FROM users WHERE id = ?',
      )
      .get(input.user_id)
    if (!target) throw new AuthError('not_found', 'User not found')
    if (target.role === input.role) return target
    if (target.role === 'admin') {
      if (input.actor_user_id === target.id && input.role !== 'admin') {
        throw new AuthError('self_demote', 'Cannot demote yourself')
      }
      const others = this.db
        .query<{ c: number }, [string]>(
          "SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND id != ?",
        )
        .get(target.id)
      if ((others?.c ?? 0) === 0) {
        throw new AuthError('last_admin', 'Cannot demote the last admin')
      }
    }
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(input.role, target.id)
    return { id: target.id, email: target.email, role: input.role, created_at: target.created_at }
  }

  findUserByEmail(email: string): User | null {
    const r = this.db
      .query<{ id: string; email: string; role: Role; created_at: string }, [string]>(
        'SELECT id, email, role, created_at FROM users WHERE email = ?',
      )
      .get(email)
    return r ?? null
  }

  findUserById(id: string): User | null {
    const r = this.db
      .query<{ id: string; email: string; role: Role; created_at: string }, [string]>(
        'SELECT id, email, role, created_at FROM users WHERE id = ?',
      )
      .get(id)
    return r ?? null
  }

  async verifyPassword(email: string, password: string): Promise<User | null> {
    const row = this.db
      .query<
        { id: string; email: string; password_hash: string; role: Role; created_at: string },
        [string]
      >('SELECT id, email, password_hash, role, created_at FROM users WHERE email = ?')
      .get(email)
    if (!row) {
      // ユーザー不在時も verify を実行してタイミングを均一化(ユーザー列挙防止)
      await verify(AuthService.DUMMY_HASH, password).catch(() => {})
      return null
    }
    const ok = await verify(row.password_hash, password)
    if (!ok) return null
    return { id: row.id, email: row.email, role: row.role, created_at: row.created_at }
  }

  // ユーザー列挙対策用ダミーハッシュ(存在しないユーザーのログイン試行でも同程度の時間を消費)
  private static readonly DUMMY_HASH =
    '$argon2id$v=19$m=65536,t=3,p=4$ZHVtbXlkdW1teWR1bW15$hbikWtYliFlmBBUeKmWkLqYB+HRTM0RLOhEuPHMO6OI'

  // --- セッション ---

  createSession(user_id: string): { id: string; token: string; expires_at: string } {
    const id = newId()
    // 不透明トークン:ID + 32 バイトランダム
    const rand = new Uint8Array(32)
    crypto.getRandomValues(rand)
    const token = `${id}.${encodeBase64urlNoPadding(rand)}`
    // トークン全体の SHA-256 ハッシュを保存し、resolveSession で照合する
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86_400_000).toISOString()
    this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, expires_at, created_at, token_hash) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, user_id, expires, now(), tokenHash)
    return { id, token, expires_at: expires }
  }

  resolveSession(token: string): User | null {
    const parts = token.split('.')
    const sessionId = parts[0]
    if (!sessionId || parts.length < 2) return null
    // トークン全体の SHA-256 ハッシュで照合(ランダム部分も必ず検証)
    const tokenHash = createHash('sha256').update(token).digest('hex')
    const row = this.db
      .query<
        {
          user_id: string
          expires_at: string
          email: string
          role: Role
          created_at: string
          token_hash: string | null
        },
        [string, string]
      >(
        `SELECT s.user_id, s.expires_at, s.token_hash, u.email, u.role, u.created_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ? AND (s.token_hash IS NULL OR s.token_hash = ?)`,
      )
      .get(sessionId, tokenHash)
    if (!row) return null
    if (Date.parse(row.expires_at) < Date.now()) {
      this.deleteSession(sessionId)
      return null
    }
    return { id: row.user_id, email: row.email, role: row.role, created_at: row.created_at }
  }

  deleteSession(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
  }

  // --- 招待 ---

  createInvitation(input: { email: string; role: Role; invited_by: string }): Invitation {
    const id = newId()
    const rand = new Uint8Array(24)
    crypto.getRandomValues(rand)
    const token = encodeBase64urlNoPadding(rand)
    const created_at = now()
    const expires_at = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000).toISOString()
    this.db
      .prepare(
        `INSERT INTO invitations (id, email, role, token, expires_at, invited_by, created_at)
         VALUES ($id, $email, $role, $token, $exp, $by, $ts)`,
      )
      .run({
        id,
        email: input.email,
        role: input.role,
        token,
        exp: expires_at,
        by: input.invited_by,
        ts: created_at,
      })
    return {
      id,
      email: input.email,
      role: input.role,
      token,
      expires_at,
      used_at: null,
      invited_by: input.invited_by,
      created_at,
    }
  }

  /** 招待トークンを消費して新規ユーザー作成。1 度使うと無効。 */
  async redeemInvitation(token: string, password: string): Promise<User> {
    const row = this.db
      .query<
        { id: string; email: string; role: Role; expires_at: string; used_at: string | null },
        [string]
      >('SELECT id, email, role, expires_at, used_at FROM invitations WHERE token = ?')
      .get(token)
    if (!row) throw new AuthError('invalid_token', 'Invalid invitation token')
    if (row.used_at) throw new AuthError('already_used', 'Invitation already used')
    if (Date.parse(row.expires_at) < Date.now())
      throw new AuthError('expired', 'Invitation expired')
    const user = await this.createUser({ email: row.email, password, role: row.role })
    this.db.prepare('UPDATE invitations SET used_at = ? WHERE id = ?').run(now(), row.id)
    return user
  }
}
