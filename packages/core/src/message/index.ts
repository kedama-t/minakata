import { EventEmitter } from 'node:events'
import type { Db } from '../db/index.ts'
import { newId, now } from '../util/id.ts'

export type MessageRole = 'user' | 'agent'

export interface MessageRow {
  id: string
  session_id: string
  role: MessageRole
  content: string
  is_final: boolean
  created_at: string
  claimed_at: string | null
  claimed_by: string | null
}

export interface ChatSession {
  id: string
  user_id: string
  title: string
  created_at: string
  updated_at: string
}

export interface ChatSessionListItem extends ChatSession {
  last_message: string | null
  last_message_role: MessageRole | null
}

/**
 * チャットメッセージバス。
 * - user メッセージ → DB に保存 → Hermes が poll で取得
 * - agent 応答 → DB に保存 + EventEmitter で `web` の SSE ハンドラに通知
 *
 * P10: Web ↔ Agent は SQLite + EventEmitter 経由。WebSocket 等は使わない。
 */
export class MessageService extends EventEmitter {
  constructor(private readonly db: Db) {
    super()
    this.setMaxListeners(0)
  }

  createSession(input: { user_id: string; title?: string }): ChatSession {
    const id = newId()
    const ts = now()
    const title = input.title ?? ''
    this.db
      .prepare(
        'INSERT INTO chat_sessions (id, user_id, title, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.user_id, title, 'dialogue', ts, ts)
    return { id, user_id: input.user_id, title, created_at: ts, updated_at: ts }
  }

  updateTitle(id: string, title: string): void {
    this.db
      .prepare('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, now(), id)
  }

  getSession(id: string): ChatSession | null {
    const r = this.db
      .query<ChatSession, [string]>(
        'SELECT id, user_id, title, created_at, updated_at FROM chat_sessions WHERE id = ?',
      )
      .get(id)
    return r ?? null
  }

  /** ユーザー発言を保存。Hermes が次回 poll で取得する */
  postUser(session_id: string, content: string): MessageRow {
    const id = newId()
    const created_at = now()
    this.db
      .prepare(
        'INSERT INTO messages (id, session_id, role, content, is_final, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, session_id, 'user', content, 1, created_at)
    this.touchSession(session_id, created_at)
    const row: MessageRow = {
      id,
      session_id,
      role: 'user',
      content,
      is_final: true,
      created_at,
      claimed_at: null,
      claimed_by: null,
    }
    this.emit('user-posted', row)
    return row
  }

  /**
   * Hermes が応答チャンクを書き戻す。is_final=true で締めくくる。
   * Web の SSE ハンドラは `agent-response` イベントを listen している。
   */
  postAgentResponse(input: {
    session_id: string
    content: string
    is_final: boolean
  }): MessageRow {
    const id = newId()
    const created_at = now()
    this.db
      .prepare(
        'INSERT INTO messages (id, session_id, role, content, is_final, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, input.session_id, 'agent', input.content, input.is_final ? 1 : 0, created_at)
    this.touchSession(input.session_id, created_at)
    const row: MessageRow = {
      id,
      session_id: input.session_id,
      role: 'agent',
      content: input.content,
      is_final: input.is_final,
      created_at,
      claimed_at: null,
      claimed_by: null,
    }
    this.emit('agent-response', row)
    return row
  }

  /** Hermes が未取得の user メッセージを取り出す(poll_messages) */
  pollUserMessages(limit = 20): MessageRow[] {
    const rows = this.db
      .query<RawMessageRow, [number]>(
        `SELECT id, session_id, role, content, is_final, created_at, claimed_at, claimed_by
         FROM messages
         WHERE role = 'user' AND claimed_at IS NULL
         ORDER BY created_at
         LIMIT ?`,
      )
      .all(limit)
    return rows.map(hydrate)
  }

  /** メッセージを claim する */
  claim(messageId: string, claimedBy: string): { claimed: boolean } {
    const ts = now()
    const res = this.db
      .prepare(
        `UPDATE messages SET claimed_at = ?, claimed_by = ?
         WHERE id = ? AND claimed_at IS NULL`,
      )
      .run(ts, claimedBy, messageId)
    return { claimed: res.changes > 0 }
  }

  /**
   * 指定ユーザーの過去対話セッション一覧を `updated_at` 降順で取得する。
   * `before` でカーソルページング。末尾メッセージ抜粋付き(プレビュー表示用)。
   */
  listSessionsByUser(opts: {
    user_id: string
    limit?: number | undefined
    before?: string | undefined
  }): ChatSessionListItem[] {
    const limit = opts.limit ?? 30
    const conditions: string[] = ['s.user_id = ?']
    const params: Array<string | number> = [opts.user_id]
    if (opts.before) {
      conditions.push('s.updated_at < ?')
      params.push(opts.before)
    }
    params.push(limit)
    const rows = this.db
      .query<
        {
          id: string
          user_id: string
          title: string
          created_at: string
          updated_at: string
          last_message: string | null
          last_message_role: MessageRole | null
        },
        Array<string | number>
      >(
        `SELECT s.id, s.user_id, s.title, s.created_at, s.updated_at,
                (SELECT content FROM messages m WHERE m.session_id = s.id
                  ORDER BY m.created_at DESC LIMIT 1) AS last_message,
                (SELECT role FROM messages m WHERE m.session_id = s.id
                  ORDER BY m.created_at DESC LIMIT 1) AS last_message_role
           FROM chat_sessions s
          WHERE ${conditions.join(' AND ')}
          ORDER BY s.updated_at DESC, s.id DESC
          LIMIT ?`,
      )
      .all(...params)
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      title: r.title,
      created_at: r.created_at,
      updated_at: r.updated_at,
      last_message: r.last_message,
      last_message_role: r.last_message_role,
    }))
  }

  /** セッション内の全メッセージを時系列で取得(画面表示用) */
  listBySession(session_id: string): MessageRow[] {
    const rows = this.db
      .query<RawMessageRow, [string]>(
        `SELECT id, session_id, role, content, is_final, created_at, claimed_at, claimed_by
         FROM messages WHERE session_id = ? ORDER BY created_at`,
      )
      .all(session_id)
    return rows.map(hydrate)
  }

  /**
   * SSE ハンドラ用:特定セッションの `agent-response` を listen する AsyncIterable を返す。
   * 呼び出し側は `for await (const chunk of subscribe(sessionId)) { ... }` で使う。
   */
  subscribe(session_id: string, signal?: AbortSignal): AsyncIterable<MessageRow> {
    const emitter = this
    return {
      [Symbol.asyncIterator]() {
        const queue: MessageRow[] = []
        let resolver: ((v: IteratorResult<MessageRow>) => void) | null = null
        let done = false
        const onAgent = (row: MessageRow) => {
          if (row.session_id !== session_id) return
          if (resolver) {
            const r = resolver
            resolver = null
            r({ value: row, done: false })
          } else {
            queue.push(row)
          }
        }
        const stop = () => {
          if (done) return
          done = true
          emitter.off('agent-response', onAgent)
          if (resolver) {
            const r = resolver
            resolver = null
            r({ value: undefined as unknown as MessageRow, done: true })
          }
        }
        emitter.on('agent-response', onAgent)
        signal?.addEventListener('abort', stop, { once: true })
        return {
          next(): Promise<IteratorResult<MessageRow>> {
            if (done)
              return Promise.resolve({ value: undefined as unknown as MessageRow, done: true })
            if (queue.length > 0) {
              const v = queue.shift() as MessageRow
              return Promise.resolve({ value: v, done: false })
            }
            return new Promise((res) => {
              resolver = res
            })
          },
          return(): Promise<IteratorResult<MessageRow>> {
            stop()
            return Promise.resolve({ value: undefined as unknown as MessageRow, done: true })
          },
        }
      },
    }
  }

  private touchSession(id: string, ts: string): void {
    this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(ts, id)
  }
}

interface RawMessageRow {
  id: string
  session_id: string
  role: MessageRole
  content: string
  is_final: number
  created_at: string
  claimed_at: string | null
  claimed_by: string | null
}

function hydrate(r: RawMessageRow): MessageRow {
  return {
    id: r.id,
    session_id: r.session_id,
    role: r.role,
    content: r.content,
    is_final: r.is_final === 1,
    created_at: r.created_at,
    claimed_at: r.claimed_at,
    claimed_by: r.claimed_by,
  }
}
